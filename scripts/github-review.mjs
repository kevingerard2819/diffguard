import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const COMMENT_MARKER = "<!-- diffguard-review -->";
const RISK_RANK = Object.freeze({ clear: 0, low: 1, medium: 2, high: 3, critical: 4 });
const ALLOWED_FAIL_LEVELS = new Set(["never", "low", "medium", "high", "critical"]);

function commandValue(value) {
  return String(value).replace(/[\r\n]/g, " ").slice(0, 2_000);
}

function annotation(kind, message) {
  console.log(`::${kind}::${commandValue(message)}`);
}

function markdownText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function parseBoolean(value, name) {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function parseRepository(value) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(String(value).trim());
  if (!match) throw new Error("GITHUB_REPOSITORY must use the owner/repository format.");
  return { owner: match[1], repository: match[2] };
}

function parsePullRequestNumber(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error("A positive pull request number is required.");
  }
  return number;
}

export function resolvePullRequestNumber(explicitValue, eventPayload) {
  if (String(explicitValue || "").trim()) return parsePullRequestNumber(explicitValue);
  const candidate = eventPayload?.pull_request?.number ?? eventPayload?.issue?.number;
  return parsePullRequestNumber(candidate);
}

export function resolveReportPath(workspace, requestedPath) {
  const root = resolve(workspace);
  const target = resolve(root, String(requestedPath || "diffguard-review.json"));
  const pathFromRoot = relative(root, target);
  const outsideWorkspace = pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot);
  if (!pathFromRoot || outsideWorkspace) {
    throw new Error("report-path must resolve to a file inside GITHUB_WORKSPACE.");
  }
  if (/[\r\n]/.test(target)) throw new Error("report-path cannot contain line breaks.");
  return target;
}

export function shouldFailReview(riskLevel, failOn) {
  const normalizedRisk = String(riskLevel).toLowerCase();
  const normalizedThreshold = String(failOn || "never").toLowerCase();
  if (!Object.hasOwn(RISK_RANK, normalizedRisk)) throw new Error(`Unknown DiffGuard risk level: ${riskLevel}`);
  if (!ALLOWED_FAIL_LEVELS.has(normalizedThreshold)) {
    throw new Error("fail-on must be never, low, medium, high, or critical.");
  }
  return normalizedThreshold !== "never" && RISK_RANK[normalizedRisk] >= RISK_RANK[normalizedThreshold];
}

function validateReviewResult(value) {
  if (!value || typeof value !== "object") throw new Error("DiffGuard returned an invalid response body.");
  if (typeof value.reviewId !== "string" || !value.reviewId) throw new Error("DiffGuard response is missing reviewId.");
  if (!Number.isInteger(value.riskScore) || value.riskScore < 0 || value.riskScore > 100) {
    throw new Error("DiffGuard response contains an invalid riskScore.");
  }
  if (!Object.hasOwn(RISK_RANK, String(value.riskLevel))) throw new Error("DiffGuard response contains an invalid riskLevel.");
  if (!Array.isArray(value.findings)) throw new Error("DiffGuard response is missing findings.");
  return value;
}

export function buildReviewMarkdown(result, pullRequestUrl) {
  const findings = result.findings.slice(0, 20);
  const rows = findings.map((finding) => {
    const evidence = Array.isArray(finding.evidence) && finding.evidence[0] ? finding.evidence[0] : {};
    const location = evidence.filePath
      ? `${evidence.filePath}${evidence.newLine ? `:${evidence.newLine}` : ""}`
      : "Validated diff evidence";
    const confidence = typeof finding.confidence === "number"
      ? `${Math.round(finding.confidence * 100)}%`
      : "—";
    return `| ${markdownText(finding.severity || "unknown")} | ${markdownText(finding.title || "Untitled finding")} | ${markdownText(location)} | ${confidence} |`;
  });

  const omitted = result.findings.length - findings.length;
  const table = rows.length
    ? [
        "| Severity | Finding | Evidence | Confidence |",
        "| --- | --- | --- | ---: |",
        ...rows,
        ...(omitted > 0 ? [`\n_${omitted} additional findings are available in the JSON artifact._`] : []),
      ].join("\n")
    : "No supported findings were returned. A clear result is not a guarantee that the change is safe.";

  const rejected = Number(result.aiReview?.trace?.rejectedCount || 0);
  const coverage = typeof result.guardrails?.evidenceCoverage === "number"
    ? `${Math.round(result.guardrails.evidenceCoverage * 100)}%`
    : "unknown";

  return [
    COMMENT_MARKER,
    "## DiffGuard evidence-first review",
    "",
    `**Risk:** ${markdownText(result.riskLevel).toUpperCase()} (${result.riskScore}/100) · **Mode:** ${markdownText(result.analysisMode || "unknown")} · **Review:** \`${markdownText(result.reviewId)}\``,
    "",
    `Evidence coverage: **${coverage}** · Unsupported AI candidates rejected: **${rejected}**`,
    "",
    table,
    "",
    `[Open pull request](${pullRequestUrl}) · Full structured evidence is attached to this workflow run as JSON.`,
    "",
    "_DiffGuard validates line references and exact quotes; it does not prove semantic correctness or the absence of vulnerabilities._",
  ].join("\n");
}

function loadEventPayload(eventPath) {
  if (!eventPath) return {};
  try {
    return JSON.parse(readFileSync(eventPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read GITHUB_EVENT_PATH: ${error instanceof Error ? error.message : "invalid payload"}`);
  }
}

function normalizeDiffGuardUrl(value) {
  let base;
  try {
    base = new URL(String(value));
  } catch {
    throw new Error("diffguard-url must be a valid URL.");
  }
  const local = base.hostname === "localhost" || base.hostname === "127.0.0.1";
  if (base.protocol !== "https:" && !(local && base.protocol === "http:")) {
    throw new Error("diffguard-url must use HTTPS (HTTP is allowed only for localhost)." );
  }
  base.username = "";
  base.password = "";
  base.search = "";
  base.hash = "";
  return base;
}

async function requestReview(baseUrl, pullRequestUrl) {
  const endpoint = new URL("/api/review", baseUrl);
  const requestId = `gha_${process.env.GITHUB_RUN_ID || "local"}_${process.env.GITHUB_RUN_ATTEMPT || "1"}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
    },
    body: JSON.stringify({ source: "github", value: pullRequestUrl }),
    signal: AbortSignal.timeout(70_000),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 1_000);
    throw new Error(`DiffGuard review failed with HTTP ${response.status}: ${body}`);
  }
  return validateReviewResult(await response.json());
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "diffguard-action",
  };
}

async function upsertPullRequestComment({ apiUrl, owner, repository, pullRequestNumber, token, body }) {
  const marker = COMMENT_MARKER;
  const commentsUrl = new URL(`/repos/${owner}/${repository}/issues/${pullRequestNumber}/comments`, apiUrl);
  const listResponse = await fetch(`${commentsUrl}?per_page=100`, { headers: githubHeaders(token) });
  if (!listResponse.ok) throw new Error(`GitHub comment lookup failed with HTTP ${listResponse.status}.`);
  const comments = await listResponse.json();
  const existing = Array.isArray(comments)
    ? comments.find((comment) => typeof comment?.body === "string" && comment.body.includes(marker))
    : undefined;

  if (existing?.id) {
    const updateUrl = new URL(`/repos/${owner}/${repository}/issues/comments/${existing.id}`, apiUrl);
    const updateResponse = await fetch(updateUrl, {
      method: "PATCH",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (updateResponse.ok) return "updated";
  }

  const createResponse = await fetch(commentsUrl, {
    method: "POST",
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!createResponse.ok) throw new Error(`GitHub comment creation failed with HTTP ${createResponse.status}.`);
  return "created";
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${commandValue(value)}\n`, "utf8");
}

export async function main() {
  const repositoryContext = parseRepository(process.env.GITHUB_REPOSITORY);
  const eventPayload = loadEventPayload(process.env.GITHUB_EVENT_PATH);
  const pullRequestNumber = resolvePullRequestNumber(process.env.DIFFGUARD_PR_NUMBER, eventPayload);
  const pullRequestUrl = `https://github.com/${repositoryContext.owner}/${repositoryContext.repository}/pull/${pullRequestNumber}`;
  const baseUrl = normalizeDiffGuardUrl(process.env.DIFFGUARD_URL);
  const failOn = String(process.env.DIFFGUARD_FAIL_ON || "never").toLowerCase();
  const shouldComment = parseBoolean(process.env.DIFFGUARD_COMMENT || "true", "comment");
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const reportPath = resolveReportPath(workspace, process.env.DIFFGUARD_REPORT_PATH);

  console.log(`Requesting DiffGuard review for ${pullRequestUrl}`);
  const result = await requestReview(baseUrl, pullRequestUrl);
  const markdown = buildReviewMarkdown(result, pullRequestUrl);

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, "utf8");

  let commentStatus = "skipped-disabled";
  const token = String(process.env.DIFFGUARD_GITHUB_TOKEN || "").trim();
  if (shouldComment && !token) {
    commentStatus = "skipped-no-token";
    annotation("warning", "DiffGuard completed, but no github-token was supplied; the PR comment was skipped.");
  } else if (shouldComment) {
    try {
      const apiUrl = normalizeDiffGuardUrl(process.env.GITHUB_API_URL || "https://api.github.com");
      commentStatus = await upsertPullRequestComment({
        apiUrl,
        ...repositoryContext,
        pullRequestNumber,
        token,
        body: markdown,
      });
    } catch (error) {
      commentStatus = "skipped-permission";
      annotation("warning", `${error instanceof Error ? error.message : "PR comment failed"} The JSON report and job summary are still available.`);
    }
  }

  writeOutput("review-id", result.reviewId);
  writeOutput("risk-score", result.riskScore);
  writeOutput("risk-level", result.riskLevel);
  writeOutput("report-path", reportPath);
  writeOutput("comment-status", commentStatus);

  console.log(`DiffGuard review ${result.reviewId}: ${result.riskLevel} (${result.riskScore}/100), ${result.findings.length} findings.`);
  if (shouldFailReview(result.riskLevel, failOn)) {
    throw new Error(`DiffGuard risk level ${result.riskLevel} meets the configured ${failOn} failure threshold.`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    annotation("error", error instanceof Error ? error.message : "DiffGuard action failed.");
    process.exitCode = 1;
  });
}
