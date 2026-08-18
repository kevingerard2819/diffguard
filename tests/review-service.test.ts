import { describe, expect, it } from "vitest";
import { deduplicateFindings, scoreFindings } from "@/lib/deterministic-review";
import { DEMO_ADVERSARIAL_LLM_REVIEW, DEMO_DIFF } from "@/lib/fixtures";
import { parsePublicGitHubPullRequestUrl } from "@/lib/github";
import { reviewDiff } from "@/lib/review-service";

describe("review service", () => {
  it("returns a complete deterministic result without an API key", async () => {
    const result = await reviewDiff(DEMO_DIFF, {
      source: { kind: "demo", label: "Test demo" },
      useLlm: false,
    });
    expect(result.findings.map((finding) => finding.ruleId)).toEqual([
      "DG-SQL-001",
      "DG-SECRET-001",
      "DG-EXEC-001",
      "DG-AI-001",
    ]);
    expect(result.riskScore).toBe(86);
    expect(result.guardrails).toMatchObject({ validatedCitationRate: 1, promptInjectionSignals: 1 });
    expect(result.analysisMode).toBe("deterministic");
    expect(result.aiReview.mode).toBe("not-run");
  });

  it("preserves raw, approved, and rejected adversarial fixture candidates", async () => {
    const result = await reviewDiff(DEMO_DIFF, {
      source: { kind: "demo", label: "Adversarial demo" },
      useLlm: false,
      adversarialFixture: DEMO_ADVERSARIAL_LLM_REVIEW,
    });
    expect(result.aiReview).toMatchObject({
      mode: "fixture",
      trace: { rawCount: 5, approvedCount: 1, rejectedCount: 4, injectionSignals: 1 },
    });
    expect(result.aiReview.rejectedFindings.map((item) => item.reasonCode)).toEqual([
      "DUPLICATE_FINDING",
      "UNKNOWN_LINE_ID",
      "EVIDENCE_QUOTE_MISMATCH",
      "LOW_CONFIDENCE",
    ]);
    expect(result.findings.every((finding) => finding.source === "deterministic")).toBe(true);
  });

  it("does not let an exact duplicate increase the score", async () => {
    const result = await reviewDiff(DEMO_DIFF, {
      source: { kind: "demo", label: "Score test" },
      useLlm: false,
    });
    const finding = result.findings[0];
    expect(scoreFindings([finding, { ...finding, id: "duplicate" }]))
      .toEqual(scoreFindings([finding]));
  });

  it("does not label a calibrated high-severity rule match as low overall risk", async () => {
    const result = await reviewDiff(DEMO_DIFF, {
      source: { kind: "demo", label: "Severity floor test" },
      useLlm: false,
    });
    expect(scoreFindings([result.findings[0]])).toEqual({ riskScore: 24, riskLevel: "medium" });
  });

  it("merges deterministic and model findings for the same category and primary line", async () => {
    const result = await reviewDiff(DEMO_DIFF, {
      source: { kind: "demo", label: "Cross-source deduplication" },
      useLlm: false,
    });
    const deterministicFinding = result.findings[0];
    const modelFinding = {
      ...deterministicFinding,
      id: "llm-overlap",
      ruleId: "LLM-SQL-OVERLAP",
      title: "Model restatement of the SQL concern",
      source: "llm" as const,
    };

    expect(deduplicateFindings([modelFinding, deterministicFinding])).toEqual([deterministicFinding]);
    expect(scoreFindings([modelFinding, deterministicFinding])).toEqual(scoreFindings([deterministicFinding]));
  });
});

describe("public GitHub URL boundary", () => {
  it("accepts only the supported PR shape", () => {
    expect(parsePublicGitHubPullRequestUrl("https://github.com/openai/openai-node/pull/123"))
      .toEqual({ owner: "openai", repo: "openai-node", pullNumber: 123 });
  });

  it.each([
    "http://github.com/openai/openai-node/pull/123",
    "https://github.example.com/openai/openai-node/pull/123",
    "https://github.com/openai/openai-node/issues/123",
    "https://github.com/openai/openai-node/pull/not-a-number",
  ])("rejects unsupported URL %s", (url) => {
    expect(() => parsePublicGitHubPullRequestUrl(url)).toThrow();
  });
});
