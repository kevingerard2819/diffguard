import { describe, expect, it } from "vitest";
import { flattenTrustedLines, parseUnifiedDiff } from "@/lib/diff-parser";
import { DEMO_DIFF } from "@/lib/fixtures";
import {
  acceptSupportedLlmFindings,
  LlmReviewSchema,
  validateLlmReview,
} from "@/lib/guardrails";

const baseFinding = {
  ruleId: "LLM-SEC-001",
  title: "Supported model finding",
  description: "A model-generated issue with concrete evidence.",
  category: "security" as const,
  severity: "high" as const,
  confidence: 0.8,
  suggestedFix: "Use the safe alternative.",
  recommendedTests: ["Exercise the hostile input path."],
};

describe("model evidence guardrail", () => {
  const trustedLines = flattenTrustedLines(parseUnifiedDiff(DEMO_DIFF));
  const trustedLine = trustedLines[1];
  const supportedEvidence = [{
    lineId: trustedLine.id,
    quote: trustedLine.content,
    reason: "This line introduces the issue.",
  }];

  it("accepts an assigned ID only when the exact quote also matches", () => {
    const candidate = LlmReviewSchema.parse({
      findings: [{ ...baseFinding, evidence: supportedEvidence }],
    });
    const result = acceptSupportedLlmFindings(candidate, trustedLines);
    expect(result.approvedFindings).toHaveLength(1);
    expect(result.approvedFindings[0].evidence[0].lineId).toBe(trustedLine.id);
    expect(result.rejectedFindings).toHaveLength(0);
  });

  it("rejects the entire finding when the model invents a line ID", () => {
    const candidate = LlmReviewSchema.parse({
      findings: [{
        ...baseFinding,
        evidence: [{ ...supportedEvidence[0], lineId: "DG-INVENTED-L999" }],
      }],
    });
    const result = acceptSupportedLlmFindings(candidate, trustedLines);
    expect(result.approvedFindings).toHaveLength(0);
    expect(result.rejectedFindings[0].reasonCode).toBe("UNKNOWN_LINE_ID");
  });

  it("rejects mixed valid and invented IDs", () => {
    const candidate = LlmReviewSchema.parse({
      findings: [{
        ...baseFinding,
        evidence: [supportedEvidence[0], { ...supportedEvidence[0], lineId: "DG-INVENTED-L999" }],
      }],
    });
    expect(acceptSupportedLlmFindings(candidate, trustedLines).rejectedFindings[0].reasonCode)
      .toBe("UNKNOWN_LINE_ID");
  });

  it("rejects a real line ID paired with a fabricated quote", () => {
    const candidate = LlmReviewSchema.parse({
      findings: [{
        ...baseFinding,
        evidence: [{ ...supportedEvidence[0], quote: "const safe = true;" }],
      }],
    });
    expect(acceptSupportedLlmFindings(candidate, trustedLines).rejectedFindings[0].reasonCode)
      .toBe("EVIDENCE_QUOTE_MISMATCH");
  });

  it("rejects low-confidence and duplicate candidates before scoring", () => {
    const candidate = LlmReviewSchema.parse({
      findings: [
        { ...baseFinding, confidence: 0.2, evidence: supportedEvidence },
        { ...baseFinding, evidence: supportedEvidence },
        { ...baseFinding, title: "Repeated claim", evidence: supportedEvidence },
      ],
    });
    const result = acceptSupportedLlmFindings(candidate, trustedLines);
    expect(result.approvedFindings).toHaveLength(1);
    expect(result.rejectedFindings.map((item) => item.reasonCode)).toEqual([
      "LOW_CONFIDENCE",
      "DUPLICATE_FINDING",
    ]);
  });

  it.each([
    [{ ...baseFinding, confidence: 1.7, evidence: supportedEvidence }, "INVALID_CONFIDENCE"],
    [{ ...baseFinding, severity: "urgent", evidence: supportedEvidence }, "INVALID_SEVERITY"],
    [{ ...baseFinding, evidence: [] }, "MISSING_EVIDENCE"],
  ])("returns a specific reason for malformed structured output", (finding, reasonCode) => {
    expect(validateLlmReview({ findings: [finding] })).toMatchObject({
      success: false,
      reasonCode,
    });
  });
});
