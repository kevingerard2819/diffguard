import { createHash } from "node:crypto";
import type { ReviewResult } from "@/lib/domain";
import { ReviewResultSchema } from "@/lib/domain";
import { flattenTrustedLines, parseUnifiedDiff } from "@/lib/diff-parser";
import {
  deduplicateFindings,
  findPromptInjectionLines,
  runDeterministicChecks,
  scoreFindings,
} from "@/lib/deterministic-review";
import { acceptSupportedLlmFindings, type LlmReview } from "@/lib/guardrails";
import { requestLlmReview, selectModelLines } from "@/lib/gemini-review";

type ReviewOptions = {
  source: ReviewResult["source"];
  useLlm?: boolean;
  adversarialFixture?: LlmReview;
};

export async function reviewDiff(diff: string, options: ReviewOptions): Promise<ReviewResult> {
  const files = parseUnifiedDiff(diff);
  const trustedLines = flattenTrustedLines(files);
  const deterministic = runDeterministicChecks(files);
  const warnings: string[] = [];
  let llmFindings: ReviewResult["findings"] = [];
  let rejectedUnsupportedReferences = 0;
  let analysisMode: ReviewResult["analysisMode"] = "deterministic";
  const promptInjectionSignals = findPromptInjectionLines(files).length;
  let aiReview: ReviewResult["aiReview"] = {
    mode: "not-run",
    rawFindings: [],
    approvedFindings: [],
    rejectedFindings: [],
    trace: {
      rawCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      injectionSignals: promptInjectionSignals,
    },
  };

  if (options.adversarialFixture) {
    const guarded = acceptSupportedLlmFindings(options.adversarialFixture, trustedLines);
    aiReview = {
      mode: "fixture",
      rawFindings: guarded.rawFindings,
      approvedFindings: guarded.approvedFindings,
      rejectedFindings: guarded.rejectedFindings,
      trace: {
        rawCount: guarded.rawFindings.length,
        approvedCount: guarded.approvedFindings.length,
        rejectedCount: guarded.rejectedFindings.length,
        injectionSignals: promptInjectionSignals,
      },
    };
    rejectedUnsupportedReferences = guarded.rejectedUnsupportedReferences;
    warnings.push("The Raw AI comparison is a seeded adversarial fixture, not output from a live model.");
  } else if (options.useLlm && process.env.GEMINI_API_KEY) {
    try {
      const modelInput = selectModelLines(trustedLines);
      if (modelInput.truncated) {
        warnings.push("AI input was capped at 80,000 characters; deterministic checks still covered the full diff.");
      }
      const accepted = acceptSupportedLlmFindings(
        await requestLlmReview(modelInput.lines),
        modelInput.lines,
      );
      llmFindings = accepted.findings;
      rejectedUnsupportedReferences = accepted.rejectedUnsupportedReferences;
      aiReview = {
        mode: "live",
        rawFindings: accepted.rawFindings,
        approvedFindings: accepted.approvedFindings,
        rejectedFindings: accepted.rejectedFindings,
        trace: {
          rawCount: accepted.rawFindings.length,
          approvedCount: accepted.approvedFindings.length,
          rejectedCount: accepted.rejectedFindings.length,
          injectionSignals: promptInjectionSignals,
        },
      };
      analysisMode = "hybrid";
    } catch (error) {
      warnings.push(`AI analysis was unavailable; deterministic results are still complete. ${error instanceof Error ? error.message : "Unknown model error."}`);
    }
  } else if (options.useLlm) {
    warnings.push("GEMINI_API_KEY is not set, so this review used deterministic checks only.");
  }

  const findings = deduplicateFindings([...deterministic, ...llmFindings]);
  const { riskScore, riskLevel } = scoreFindings(findings);
  const evidenceCount = findings.reduce((total, finding) => total + finding.evidence.length, 0);
  const validEvidenceCount = findings.reduce((total, finding) =>
    total + finding.evidence.filter((item) => trustedLines.some((line) => line.id === item.lineId)).length, 0,
  );

  return ReviewResultSchema.parse({
    reviewId: createHash("sha256").update(diff).digest("hex").slice(0, 12),
    createdAt: new Date().toISOString(),
    source: options.source,
    riskScore,
    riskLevel,
    findings,
    files,
    summary: {
      filesChanged: files.length,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
      trustedLineCount: trustedLines.length,
    },
    guardrails: {
      validatedCitationRate: evidenceCount === 0 ? 1 : validEvidenceCount / evidenceCount,
      rejectedUnsupportedReferences,
      promptInjectionSignals,
    },
    analysisMode,
    aiReview,
    warnings,
  });
}
