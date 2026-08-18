import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildReviewMarkdown,
  main,
  resolvePullRequestNumber,
  resolveReportPath,
  shouldFailReview,
} from "../scripts/github-review.mjs";
import { healthEndpoint } from "../scripts/smoke-deployment.mjs";

const RESULT = {
  reviewId: "abc123",
  riskScore: 73,
  riskLevel: "high" as const,
  analysisMode: "hybrid" as const,
  findings: [{
    severity: "high",
    title: "Unsafe | interpolation <script>",
    confidence: 0.91,
    evidence: [{ filePath: "src/query.ts", newLine: 17 }],
  }],
  guardrails: { evidenceCoverage: 1 },
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
    expect(resolveReportPath(workspace, "..data.json")).toContain("..data.json");
    expect(() => resolveReportPath(workspace, "../outside.json")).toThrow(/inside GITHUB_WORKSPACE/i);
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
    expect(markdown).not.toContain("<script>");
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
      expect(readFileSync(join(workspace, "outputs.txt"), "utf8")).toContain("risk-level=high");
      expect(readFileSync(join(workspace, "summary.md"), "utf8")).toContain("DiffGuard evidence-first review");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
