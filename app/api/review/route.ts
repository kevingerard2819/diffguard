import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ReviewRequestSchema } from "@/lib/domain";
import { DEMO_ADVERSARIAL_LLM_REVIEW, DEMO_DIFF } from "@/lib/fixtures";
import { fetchPublicPullRequestDiff, GitHubFetchError } from "@/lib/github";
import {
  elapsedMilliseconds,
  logReviewCompleted,
  logReviewFailed,
  operationalHeaders,
  resolveRequestId,
} from "@/lib/observability";
import {
  applyRateLimitHeaders,
  consumeReviewRateLimit,
  type ReviewRateLimit,
} from "@/lib/rate-limit";
import { reviewDiff } from "@/lib/review-service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const startedAt = performance.now();
  let requestSource: "github" | "raw" | "demo" | "unknown" = "unknown";
  let rateLimit: ReviewRateLimit | undefined;

  try {
    const body = ReviewRequestSchema.parse(await request.json());
    requestSource = body.source;
    if (body.source !== "demo") {
      rateLimit = consumeReviewRateLimit(request.headers);
      if (!rateLimit.allowed) {
        const durationMs = elapsedMilliseconds(startedAt);
        logReviewFailed({
          requestId,
          durationMs,
          source: body.source,
          statusCode: 429,
          failureType: "rate_limit",
        });
        const headers = new Headers(operationalHeaders(requestId, durationMs));
        applyRateLimitHeaders(headers, rateLimit);
        return NextResponse.json({
          error: "Review limit reached. Try again after the retry window.",
        }, { status: 429, headers });
      }
    }

    let diff: string;
    let label: string;
    if (body.source === "github") {
      const pullRequest = await fetchPublicPullRequestDiff(body.value);
      diff = pullRequest.diff;
      label = pullRequest.label;
    } else if (body.source === "demo") {
      diff = DEMO_DIFF;
      label = "Seeded vulnerable demo";
    } else {
      diff = body.value;
      label = "Pasted unified diff";
    }
    const result = await reviewDiff(diff, {
      source: { kind: body.source, label },
      useLlm: body.source !== "demo",
      ...(body.source === "demo" ? { adversarialFixture: DEMO_ADVERSARIAL_LLM_REVIEW } : {}),
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

    const headers = new Headers(operationalHeaders(requestId, durationMs));
    if (rateLimit) applyRateLimitHeaders(headers, rateLimit);
    return NextResponse.json(result, { headers });
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
    if (rateLimit) applyRateLimitHeaders(headers, rateLimit);
    if (error instanceof GitHubFetchError && error.retryAfterSeconds) {
      headers.set("Retry-After", String(error.retryAfterSeconds));
    }
    return NextResponse.json({ error: message }, { status: statusCode, headers });
  }
}
