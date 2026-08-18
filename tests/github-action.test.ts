import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFindingAnnotations,
  buildReviewMarkdown,
  buildSarifLog,
  escapeWorkflowCommandData,
  escapeWorkflowCommandProperty,
  main,
  resolvePullRequestNumber,
  resolveReportPath,
  resolveSarifPath,
  shouldFailReview,
} from "../scripts/github-review.mjs";
import { healthEndpoint } from "../scripts/smoke-deployment.mjs";

const RESULT = {
  reviewId: "abc123",
  riskScore: 73,
  riskLevel: "high" as const,
  analysisMode: "hybrid" as const,
  findings: [{
    ruleId: "DG-SQL-001",
    severity: "high",
    title: "Unsafe | interpolation <script>",
    description: "A SQL-looking query is constructed dynamically.",
    category: "security",
    confidence: 0.91,
    source: "llm" as const,
    suggestedFix: "Use a parameterized query.",
    evidence: [{ lineId: "DG-F1-H1-L3", filePath: "src/query.ts", newLine: 17 }],
  }],
  guardrails: { validatedCitationRate: 1 },
  aiReview: { trace: { rejectedCount: 2 } },
};

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GitHub Action integration", () => {
  it("resolves explicit and event pull request numbers", () => {
    expect(resolvePullRequestNumber("42")).toBe(42);
    expect(resolvePullRequestNumber("", { pull_request: { number: 9 } })).toBe(9);
    expect(() => resolvePullRequestNumber("0")).toThrow(/positive pull request number/i);
  });

  it("keeps report files inside the workspace", () => {
    const workspace = process.cwd();
    expect(resolveReportPath(workspace, "artifacts/review.json")).toContain("artifacts");
    expect(resolveSarifPath(workspace, "artifacts/review.sarif")).toContain("artifacts");
    expect(resolveReportPath(workspace, "..data.json")).toContain("..data.json");
    expect(() => resolveReportPath(workspace, "../outside.json")).toThrow(/inside GITHUB_WORKSPACE/i);
    expect(() => resolveSarifPath(workspace, "../outside.sarif")).toThrow(/inside GITHUB_WORKSPACE/i);
  });

  it("applies an explicit risk threshold", () => {
    expect(shouldFailReview("high", "high")).toBe(true);
    expect(shouldFailReview("medium", "high")).toBe(false);
    expect(shouldFailReview("critical", "never")).toBe(false);
    expect(() => shouldFailReview("high", "unknown")).toThrow(/fail-on/i);
    expect(() => shouldFailReview("toString", "high")).toThrow(/risk level/i);
  });

  it("renders a bounded, escaped evidence summary", () => {
    const markdown = buildReviewMarkdown(RESULT, "https://github.com/acme/repo/pull/42");
    expect(markdown).toContain("HIGH (73/100)");
    expect(markdown).toContain("src/query.ts:17");
    expect(markdown).toContain("Unsafe \\| interpolation &lt;script&gt;");
    expect(markdown).toContain("Unsupported AI candidates rejected: **2**");
    expect(markdown).toContain("Validated citation rate: **100%**");
    expect(markdown).not.toContain("<script>");
  });

  it("maps guarded finding severities to bounded workflow annotations", () => {
    const findings = (["critical", "high", "medium", "low"] as const).map((severity, index) => ({
      ...RESULT.findings[0],
      severity,
      ruleId: `DG-TEST-${index}`,
      title: `${severity} finding`,
      evidence: [{ ...RESULT.findings[0].evidence[0], lineId: `DG-F1-H1-L${index + 1}`, newLine: index + 1 }],
    }));
    const annotations = buildFindingAnnotations(findings);
    expect(annotations.map((command) => command.split(" ")[0])).toEqual([
      "::error",
      "::error",
      "::warning",
      "::notice",
    ]);
    expect(annotations[0]).toContain("file=src/query.ts,line=1,title=critical finding");
    expect(annotations[0]).toContain("Rule: DG-TEST-0. Evidence: DG-F1-H1-L1.");
  });

  it("uses a general annotation for deleted evidence and caps output at ten findings", () => {
    const deletedFinding = {
      ...RESULT.findings[0],
      evidence: [{ lineId: "DG-F1-H1-L1", filePath: "src/deleted.ts", newLine: null }],
    };
    const deletedAnnotation = buildFindingAnnotations([deletedFinding])[0];
    expect(deletedAnnotation).toMatch(/^::error title=/);
    expect(deletedAnnotation).not.toContain("file=");
    expect(deletedAnnotation).toContain("src/deleted.ts (deleted or non-added line)");
    expect(buildFindingAnnotations(Array.from({ length: 12 }, () => deletedFinding))).toHaveLength(10);
  });

  it("escapes workflow-command control characters from untrusted finding content", () => {
    expect(escapeWorkflowCommandData("%\r\n:,")).toBe("%25%0D%0A:,");
    expect(escapeWorkflowCommandProperty("%\r\n:,")).toBe("%25%0D%0A%3A%2C");
    const command = buildFindingAnnotations([{
      ...RESULT.findings[0],
      title: "bad%,title:\r\n::error::injected",
      description: "risk%\r\n::warning::injected",
      evidence: [{ lineId: "DG%,ID:\r\n", filePath: "src/a,b:c%.ts", newLine: 4 }],
    }])[0];
    expect(command).toContain("file=src/a%2Cb%3Ac%25.ts,line=4,title=bad%25%2Ctitle%3A%0D%0A%3A%3Aerror%3A%3Ainjected");
    expect(command).toContain("risk%25%0D%0A::warning::injected");
    expect(command.split("\n")).toHaveLength(1);
  });

  it("exports only final approved findings to SARIF", () => {
    const sarif = buildSarifLog({
      ...RESULT,
      aiReview: {
        ...RESULT.aiReview,
        rawFindings: [{ title: "Raw rejected candidate" }],
        rejectedFindings: [{ title: "Rejected candidate" }],
      },
    }) as {
      version: string;
      runs: Array<{ tool: { driver: { rules: unknown[] } }; results: Array<Record<string, unknown>> }>;
    };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].tool.driver.rules).toHaveLength(1);
    expect(sarif.runs[0].results).toHaveLength(1);
    expect(sarif.runs[0].results[0]).toMatchObject({
      ruleId: "DG-SQL-001",
      level: "error",
      locations: [{ physicalLocation: { artifactLocation: { uri: "src/query.ts" }, region: { startLine: 17 } } }],
    });
    expect(JSON.stringify(sarif)).not.toContain("Raw rejected candidate");
    expect(JSON.stringify(sarif)).not.toContain("Rejected candidate");
  });

  it("requires HTTPS for remote smoke tests", () => {
    expect(healthEndpoint("https://diffguard.example").toString()).toBe("https://diffguard.example/api/health");
    expect(healthEndpoint("http://localhost:3000").toString()).toBe("http://localhost:3000/api/health");
    expect(() => healthEndpoint("http://diffguard.example")).toThrow(/HTTPS/);
  });

  it("runs the action boundary and writes report, outputs, and job summary", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "diffguard-action-"));
    process.env = {
      ...ORIGINAL_ENV,
      GITHUB_REPOSITORY: "acme/repo",
      GITHUB_WORKSPACE: workspace,
      GITHUB_OUTPUT: join(workspace, "outputs.txt"),
      GITHUB_STEP_SUMMARY: join(workspace, "summary.md"),
      GITHUB_EVENT_PATH: "",
      GITHUB_RUN_ID: "12345",
      DIFFGUARD_URL: "http://localhost:3000",
      DIFFGUARD_PR_NUMBER: "42",
      DIFFGUARD_COMMENT: "false",
      DIFFGUARD_FAIL_ON: "never",
      DIFFGUARD_REPORT_PATH: "review.json",
      DIFFGUARD_SARIF_PATH: "review.sarif",
    };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(RESULT), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", request);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await main();
      const [url, options] = request.mock.calls[0] as [URL, RequestInit];
      expect(url.toString()).toBe("http://localhost:3000/api/review");
      expect(JSON.parse(String(options.body))).toEqual({
        source: "github",
        value: "https://github.com/acme/repo/pull/42",
      });
      expect(JSON.parse(readFileSync(join(workspace, "review.json"), "utf8"))).toMatchObject({ reviewId: "abc123" });
      expect(JSON.parse(readFileSync(join(workspace, "review.sarif"), "utf8"))).toMatchObject({ version: "2.1.0" });
      expect(readFileSync(join(workspace, "outputs.txt"), "utf8")).toContain("risk-level=high");
      expect(readFileSync(join(workspace, "outputs.txt"), "utf8")).toContain("sarif-path=");
      expect(readFileSync(join(workspace, "summary.md"), "utf8")).toContain("DiffGuard evidence-first review");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
