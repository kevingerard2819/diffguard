import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export const RiskLevelSchema = z.enum(["critical", "high", "medium", "low", "clear"]);
export const FindingCategorySchema = z.enum([
  "security",
  "reliability",
  "maintainability",
  "ai-safety",
]);

export const DiffLineSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["added", "removed", "context"]),
  content: z.string(),
  oldLine: z.number().int().positive().nullable(),
  newLine: z.number().int().positive().nullable(),
  filePath: z.string().min(1),
});

export const DiffHunkSchema = z.object({
  header: z.string(),
  lines: z.array(DiffLineSchema),
});

export const DiffFileSchema = z.object({
  oldPath: z.string(),
  newPath: z.string(),
  path: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  hunks: z.array(DiffHunkSchema),
});

export const EvidenceSchema = z.object({
  lineId: z.string().min(1),
  filePath: z.string().min(1),
  newLine: z.number().int().positive().nullable(),
  code: z.string(),
  reason: z.string().min(1),
});

export const FindingSchema = z.object({
  id: z.string().min(1),
  ruleId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  category: FindingCategorySchema,
  severity: SeveritySchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceSchema).min(1),
  suggestedFix: z.string().min(1),
  recommendedTests: z.array(z.string().min(1)).min(1),
  source: z.enum(["deterministic", "llm"]),
});

export const AiEvidenceClaimSchema = z.object({
  lineId: z.string().min(1).max(80),
  quote: z.string().max(2_000),
  reason: z.string().min(1).max(300),
});

export const AiCandidateFindingSchema = z.object({
  ruleId: z.string().min(1).max(40),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(600),
  category: FindingCategorySchema,
  severity: SeveritySchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(AiEvidenceClaimSchema).min(1).max(4),
  suggestedFix: z.string().min(1).max(600),
  recommendedTests: z.array(z.string().min(1).max(240)).min(1).max(4),
});

export const AiRejectionReasonCodeSchema = z.enum([
  "INVALID_SCHEMA",
  "MISSING_EVIDENCE",
  "INVALID_SEVERITY",
  "INVALID_CONFIDENCE",
  "UNKNOWN_LINE_ID",
  "EVIDENCE_QUOTE_MISMATCH",
  "LOW_CONFIDENCE",
  "DUPLICATE_FINDING",
]);

export const RejectedAiFindingSchema = z.object({
  finding: AiCandidateFindingSchema,
  reasonCode: AiRejectionReasonCodeSchema,
  reason: z.string().min(1),
});

export const AiReviewBoundarySchema = z.object({
  mode: z.enum(["not-run", "live", "fixture"]),
  rawFindings: z.array(AiCandidateFindingSchema),
  approvedFindings: z.array(FindingSchema),
  rejectedFindings: z.array(RejectedAiFindingSchema),
  trace: z.object({
    rawCount: z.number().int().nonnegative(),
    approvedCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
    injectionSignals: z.number().int().nonnegative(),
  }),
});

export const ReviewResultSchema = z.object({
  reviewId: z.string(),
  createdAt: z.string(),
  source: z.object({
    kind: z.enum(["github", "raw", "demo"]),
    label: z.string(),
  }),
  riskScore: z.number().int().min(0).max(100),
  riskLevel: RiskLevelSchema,
  findings: z.array(FindingSchema),
  files: z.array(DiffFileSchema),
  summary: z.object({
    filesChanged: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    trustedLineCount: z.number().int().nonnegative(),
  }),
  guardrails: z.object({
    validatedCitationRate: z.number().min(0).max(1),
    rejectedUnsupportedReferences: z.number().int().nonnegative(),
    promptInjectionSignals: z.number().int().nonnegative(),
  }),
  analysisMode: z.enum(["deterministic", "hybrid"]),
  aiReview: AiReviewBoundarySchema,
  warnings: z.array(z.string()),
});

export const ReviewRequestSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("github"), value: z.string().url().max(500) }),
  z.object({ source: z.literal("raw"), value: z.string().min(20).max(500_000) }),
  z.object({ source: z.literal("demo") }),
]);

export type Severity = z.infer<typeof SeveritySchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type DiffLine = z.infer<typeof DiffLineSchema>;
export type DiffFile = z.infer<typeof DiffFileSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type AiCandidateFinding = z.infer<typeof AiCandidateFindingSchema>;
export type AiRejectionReasonCode = z.infer<typeof AiRejectionReasonCodeSchema>;
export type RejectedAiFinding = z.infer<typeof RejectedAiFindingSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
