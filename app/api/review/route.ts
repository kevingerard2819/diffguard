import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ReviewRequestSchema } from "@/lib/domain";
import { fetchPublicPullRequestDiff, GitHubFetchError } from "@/lib/github";
import {
  elapsedMilliseconds,
  logReviewCompleted,
  logReviewFailed,
  operationalHeaders,
  resolveRequestId,
} from "@/lib/observability";
import { reviewDiff } from "@/lib/review-service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const startedAt = performance.now();
  let requestSource: "github" | "raw" | "unknown" = "unknown";

  try {
    const body = ReviewRequestSchema.parse(await request.json());
    requestSource = body.source;
    let diff: string;
    let label: string;
    if (body.source === "github") {
      const pullRequest = await fetchPublicPullRequestDiff(body.value);
      diff = pullRequest.diff;
      label = pullRequest.label;
    } else {
      diff = body.value;
      label = "Pasted unified diff";
    }
    const result = await reviewDiff(diff, {
      source: { kind: body.source, label },
      useLlm: true,
    });
    const durationMs = elapsedMilliseconds(startedAt);

    logReviewCompleted({
      requestId,
      durationMs,
      source: body.source,
      reviewId: result.reviewId,
      analysisMode: result.analysisMode,
      filesChanged: result.summary.filesChanged,
      findingCount: result.findings.length,
      rejectedCandidateCount: result.aiReview.trace.rejectedCount,
    });

    return NextResponse.json(result, {
      headers: operationalHeaders(requestId, durationMs),
    });
  } catch (error) {
    const durationMs = elapsedMilliseconds(startedAt);
    const statusCode = error instanceof GitHubFetchError ? error.statusCode : 400;
    const message = error instanceof ZodError
      ? error.issues[0]?.message || "The review request is invalid."
      : error instanceof Error ? error.message : "The review could not be completed.";
    const failureType = error instanceof ZodError
      ? "validation"
      : error instanceof GitHubFetchError ? "github_upstream" : "review";

    logReviewFailed({
      requestId,
      durationMs,
      source: requestSource,
      statusCode,
      failureType,
    });

    const headers = new Headers(operationalHeaders(requestId, durationMs));
    if (error instanceof GitHubFetchError && error.retryAfterSeconds) {
      headers.set("Retry-After", String(error.retryAfterSeconds));
    }
    return NextResponse.json({ error: message }, { status: statusCode, headers });
  }
}
