const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

type ReviewSource = "github" | "raw" | "unknown";

interface ReviewCompletedEvent {
  requestId: string;
  durationMs: number;
  source: Exclude<ReviewSource, "unknown">;
  reviewId: string;
  analysisMode: "deterministic" | "hybrid";
  filesChanged: number;
  findingCount: number;
  rejectedCandidateCount: number;
}

interface ReviewFailedEvent {
  requestId: string;
  durationMs: number;
  source: ReviewSource;
  statusCode: number;
  failureType: "validation" | "github_upstream" | "review";
}

function operationalRecord(event: string, fields: object) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    service: "diffguard",
    event,
    ...fields,
  });
}

export function resolveRequestId(headers: Headers): string {
  const candidate = headers.get("x-request-id")?.trim();
  return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : crypto.randomUUID();
}

export function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function operationalHeaders(requestId: string, durationMs: number): HeadersInit {
  return {
    "Cache-Control": "no-store",
    "Server-Timing": `total;dur=${durationMs}`,
    "X-DiffGuard-Request-Id": requestId,
  };
}

export function logReviewCompleted(event: ReviewCompletedEvent): void {
  console.info(operationalRecord("review.completed", event));
}

export function logReviewFailed(event: ReviewFailedEvent): void {
  console.error(operationalRecord("review.failed", event));
}
