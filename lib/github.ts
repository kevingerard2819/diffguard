import { MAX_DIFF_BYTES, validateDiffEnvelope } from "@/lib/diff-parser";

const DEFAULT_ATTEMPT_TIMEOUT_MS = 8_000;
const MAX_GITHUB_ATTEMPTS = 2;
const MAX_RETRY_DELAY_MS = 1_500;

interface GitHubFetchOptions {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  attemptTimeoutMs?: number;
}

export class GitHubFetchError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "GitHubFetchError";
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : undefined;
}

function retryDelayMilliseconds(response: Response, attempt: number): number {
  const requestedDelay = retryAfterSeconds(response);
  return requestedDelay
    ? Math.min(requestedDelay * 1_000, MAX_RETRY_DELAY_MS)
    : Math.min(350 * attempt, MAX_RETRY_DELAY_MS);
}

export function parsePublicGitHubPullRequestUrl(value: string): { owner: string; repo: string; pullNumber: number } {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a valid GitHub pull request URL."); }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Only public https://github.com pull request URLs are supported.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 4 || parts[2] !== "pull" || !/^\d+$/.test(parts[3])) {
    throw new Error("Use a URL shaped like https://github.com/owner/repo/pull/123.");
  }
  const [owner, repo] = parts;
  const safeSlug = /^[A-Za-z0-9_.-]+$/;
  if (!safeSlug.test(owner) || !safeSlug.test(repo)) throw new Error("The GitHub owner or repository name is invalid.");
  return { owner, repo, pullNumber: Number(parts[3]) };
}

export async function fetchPublicPullRequestDiff(
  value: string,
  options: GitHubFetchOptions = {},
): Promise<{ diff: string; label: string }> {
  const { owner, repo, pullNumber } = parsePublicGitHubPullRequestUrl(value);
  const fetchImpl = options.fetchImpl || fetch;
  const pause = options.sleep || sleep;
  const attemptTimeoutMs = options.attemptTimeoutMs || DEFAULT_ATTEMPT_TIMEOUT_MS;
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`;

  for (let attempt = 1; attempt <= MAX_GITHUB_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
    let response: Response;

    try {
      response = await fetchImpl(apiUrl, {
        headers: { Accept: "application/vnd.github.v3.diff", "User-Agent": "DiffGuard/0.1", "X-GitHub-Api-Version": "2022-11-28" },
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      if (attempt < MAX_GITHUB_ATTEMPTS) {
        await pause(350 * attempt);
        continue;
      }
      if (timedOut) throw new GitHubFetchError("GitHub did not respond after two bounded attempts.", 504);
      throw new GitHubFetchError("GitHub could not be reached after two bounded attempts.", 502);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 404) {
      throw new GitHubFetchError("That public pull request was not found. Private repositories are outside this MVP.", 400);
    }
    if (response.status === 403) {
      throw new GitHubFetchError(
        "GitHub rate-limited this request. Paste the raw diff or try again shortly.",
        503,
        retryAfterSeconds(response),
      );
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt < MAX_GITHUB_ATTEMPTS) {
        await pause(retryDelayMilliseconds(response, attempt));
        continue;
      }
      throw new GitHubFetchError(
        response.status === 429
          ? "GitHub rate-limited this request after a bounded retry. Paste the raw diff or try again shortly."
          : `GitHub returned ${response.status} after a bounded retry.`,
        response.status === 429 ? 503 : 502,
        retryAfterSeconds(response),
      );
    }
    if (!response.ok) throw new GitHubFetchError(`GitHub returned ${response.status} while fetching the diff.`, 400);

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_DIFF_BYTES) throw new Error("This diff is larger than the 500 KB MVP limit.");
    const diff = await response.text();
    if (new TextEncoder().encode(diff).byteLength > MAX_DIFF_BYTES) throw new Error("This diff is larger than the 500 KB MVP limit.");
    validateDiffEnvelope(diff);
    return { diff, label: `${owner}/${repo} #${pullNumber}` };
  }

  throw new GitHubFetchError("GitHub could not be reached.", 502);
}
