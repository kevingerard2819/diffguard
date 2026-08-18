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
    severity: string;
    title: string;
    confidence: number;
    source?: "deterministic" | "llm";
    evidence: Array<{ filePath: string; newLine: number | null }>;
  }>;
  guardrails?: { validatedCitationRate?: number; evidenceCoverage?: number };
  aiReview?: { trace?: { rejectedCount?: number } };
}

export function resolvePullRequestNumber(explicitValue: unknown, eventPayload?: GitHubEventPayload): number;
export function resolveReportPath(workspace: string, requestedPath?: string): string;
export function shouldFailReview(riskLevel: string, failOn: string): boolean;
export function buildReviewMarkdown(result: ActionReviewResult, pullRequestUrl: string): string;
export function main(): Promise<void>;
