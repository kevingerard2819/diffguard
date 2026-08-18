export interface GitHubEventPayload {
  pull_request?: { number?: number };
  issue?: { number?: number };
}

export interface ActionReviewResult {
  reviewId: string;
  riskScore: number;
  riskLevel: "clear" | "low" | "medium" | "high" | "critical";
  analysisMode: "deterministic" | "hybrid";
  findings: Array<{
    ruleId: string;
    severity: string;
    title: string;
    description: string;
    category?: string;
    confidence: number;
    source?: "deterministic" | "llm";
    suggestedFix?: string;
    evidence: Array<{ lineId: string; filePath: string; newLine: number | null }>;
  }>;
  guardrails?: { validatedCitationRate?: number; evidenceCoverage?: number };
  aiReview?: {
    trace?: { rejectedCount?: number };
    rawFindings?: unknown[];
    approvedFindings?: unknown[];
    rejectedFindings?: unknown[];
  };
}

export function resolvePullRequestNumber(explicitValue: unknown, eventPayload?: GitHubEventPayload): number;
export function resolveReportPath(workspace: string, requestedPath?: string): string;
export function resolveSarifPath(workspace: string, requestedPath?: string): string;
export function shouldFailReview(riskLevel: string, failOn: string): boolean;
export function buildReviewMarkdown(result: ActionReviewResult, pullRequestUrl: string): string;
export function escapeWorkflowCommandData(value: unknown): string;
export function escapeWorkflowCommandProperty(value: unknown): string;
export function buildFindingAnnotations(findings: ActionReviewResult["findings"]): string[];
export function buildSarifLog(result: ActionReviewResult): object;
export function main(): Promise<void>;
