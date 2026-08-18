import { createHash } from "node:crypto";

const DEFAULT_MAX_REQUESTS = 8;
const DEFAULT_WINDOW_SECONDS = 10 * 60;
const MAX_TRACKED_CLIENTS = 5_000;

type ReviewWindow = {
  count: number;
  resetAt: number;
};

export type ReviewRateLimit = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

declare global {
  var __diffguardReviewWindows: Map<string, ReviewWindow> | undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clientFingerprint(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || headers.get("x-real-ip")?.trim() || "unknown-client";
  return createHash("sha256").update(address).digest("hex").slice(0, 24);
}

function windows(): Map<string, ReviewWindow> {
  globalThis.__diffguardReviewWindows ??= new Map();
  return globalThis.__diffguardReviewWindows;
}

function discardExpiredEntries(store: Map<string, ReviewWindow>, now: number): void {
  if (store.size < MAX_TRACKED_CLIENTS) return;
  for (const [key, value] of store) {
    if (value.resetAt <= now) store.delete(key);
  }
  if (store.size >= MAX_TRACKED_CLIENTS) {
    const oldestKey = store.keys().next().value as string | undefined;
    if (oldestKey) store.delete(oldestKey);
  }
}

export function consumeReviewRateLimit(headers: Headers, now = Date.now()): ReviewRateLimit {
  const limit = positiveInteger(process.env.DIFFGUARD_RATE_LIMIT_MAX, DEFAULT_MAX_REQUESTS);
  const windowSeconds = positiveInteger(
    process.env.DIFFGUARD_RATE_LIMIT_WINDOW_SECONDS,
    DEFAULT_WINDOW_SECONDS,
  );
  const windowMilliseconds = windowSeconds * 1_000;
  const key = clientFingerprint(headers);
  const store = windows();
  discardExpiredEntries(store, now);

  const current = store.get(key);
  const reviewWindow = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMilliseconds }
    : current;
  reviewWindow.count += 1;
  store.delete(key);
  store.set(key, reviewWindow);

  const allowed = reviewWindow.count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - reviewWindow.count),
    resetAt: reviewWindow.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((reviewWindow.resetAt - now) / 1_000)),
  };
}

export function applyRateLimitHeaders(headers: Headers, decision: ReviewRateLimit): void {
  headers.set("RateLimit-Limit", String(decision.limit));
  headers.set("RateLimit-Remaining", String(decision.remaining));
  headers.set("RateLimit-Reset", String(Math.ceil(decision.resetAt / 1_000)));
  if (!decision.allowed) headers.set("Retry-After", String(decision.retryAfterSeconds));
}

export function resetReviewRateLimitsForTests(): void {
  globalThis.__diffguardReviewWindows?.clear();
}
