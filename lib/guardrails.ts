import { z } from "zod";
import {
  AiCandidateFindingSchema,
  type AiCandidateFinding,
  type AiRejectionReasonCode,
  type DiffLine,
  type Finding,
  type RejectedAiFinding,
} from "@/lib/domain";

export const MIN_LLM_CONFIDENCE = 0.55;
export const LlmFindingSchema = AiCandidateFindingSchema;
export const LlmReviewSchema = z.object({ findings: z.array(LlmFindingSchema).max(12) });
export type LlmReview = z.infer<typeof LlmReviewSchema>;

type GuardedLlmReview = {
  rawFindings: AiCandidateFinding[];
  approvedFindings: Finding[];
  rejectedFindings: RejectedAiFinding[];
  // Compatibility aliases used by the scoring and evaluation layers.
  findings: Finding[];
  rejectedUnsupportedReferences: number;
};

function reject(
  finding: AiCandidateFinding,
  reasonCode: AiRejectionReasonCode,
  reason: string,
): RejectedAiFinding {
  return { finding, reasonCode, reason };
}

export function validateLlmReview(value: unknown):
  | { success: true; data: LlmReview }
  | { success: false; reasonCode: AiRejectionReasonCode; reason: string } {
  const parsed = LlmReviewSchema.safeParse(value);
  if (parsed.success) return { success: true, data: parsed.data };

  const issue = parsed.error.issues[0];
  const path = issue?.path.map(String) ?? [];
  let reasonCode: AiRejectionReasonCode = "INVALID_SCHEMA";
  if (path.includes("confidence")) reasonCode = "INVALID_CONFIDENCE";
  else if (path.includes("severity")) reasonCode = "INVALID_SEVERITY";
  else if (path.includes("evidence")) reasonCode = "MISSING_EVIDENCE";

  return {
    success: false,
    reasonCode,
    reason: issue?.message ?? "The model response did not match the required schema.",
  };
}

export function acceptSupportedLlmFindings(
  candidate: LlmReview,
  trustedLines: DiffLine[],
): GuardedLlmReview {
  const lineMap = new Map(trustedLines.map((line) => [line.id, line]));
  const approvedFindings: Finding[] = [];
  const rejectedFindings: RejectedAiFinding[] = [];
  const seen = new Set<string>();

  candidate.findings.forEach((item, index) => {
    const referencedLines = item.evidence.map((claim) => lineMap.get(claim.lineId));
    const unknownClaim = item.evidence.find((claim, claimIndex) => !referencedLines[claimIndex]);
    if (unknownClaim) {
      rejectedFindings.push(reject(
        item,
        "UNKNOWN_LINE_ID",
        `Referenced line ID ${unknownClaim.lineId} was not assigned by the server.`,
      ));
      return;
    }

    const mismatchedClaim = item.evidence.find((claim, claimIndex) =>
      claim.quote !== referencedLines[claimIndex]?.content,
    );
    if (mismatchedClaim) {
      rejectedFindings.push(reject(
        item,
        "EVIDENCE_QUOTE_MISMATCH",
        `The evidence quote does not exactly match ${mismatchedClaim.lineId}.`,
      ));
      return;
    }

    if (item.confidence < MIN_LLM_CONFIDENCE) {
      rejectedFindings.push(reject(
        item,
        "LOW_CONFIDENCE",
        `Confidence ${item.confidence.toFixed(2)} is below the ${MIN_LLM_CONFIDENCE.toFixed(2)} acceptance threshold.`,
      ));
      return;
    }

    const evidenceIds = item.evidence.map((claim) => claim.lineId).sort().join(",");
    const duplicateKey = `${item.ruleId}:${evidenceIds}`;
    if (seen.has(duplicateKey)) {
      rejectedFindings.push(reject(
        item,
        "DUPLICATE_FINDING",
        "A finding with the same rule and evidence was already processed.",
      ));
      return;
    }
    seen.add(duplicateKey);

    approvedFindings.push({
      id: `llm-${index + 1}-${item.ruleId.toLowerCase()}`,
      ruleId: item.ruleId,
      title: item.title,
      description: item.description,
      category: item.category,
      severity: item.severity,
      confidence: item.confidence,
      evidence: item.evidence.map((claim, claimIndex) => {
        const line = referencedLines[claimIndex] as DiffLine;
        return {
          lineId: line.id,
          filePath: line.filePath,
          newLine: line.newLine,
          code: line.content,
          reason: claim.reason,
        };
      }),
      suggestedFix: item.suggestedFix,
      recommendedTests: item.recommendedTests,
      source: "llm",
    });
  });

  return {
    rawFindings: candidate.findings,
    approvedFindings,
    rejectedFindings,
    findings: approvedFindings,
    rejectedUnsupportedReferences: rejectedFindings.filter(
      (item) => item.reasonCode === "UNKNOWN_LINE_ID",
    ).length,
  };
}
