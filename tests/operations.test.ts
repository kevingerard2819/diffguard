import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";
import { GET as healthCheck } from "@/app/api/health/route";
import { POST as reviewRequest } from "@/app/api/review/route";
import { resetReviewRateLimitsForTests } from "@/lib/rate-limit";

const RAW_DIFF = `diff --git a/src/value.ts b/src/value.ts
--- a/src/value.ts
+++ b/src/value.ts
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetReviewRateLimitsForTests();
});

describe("operational hardening", () => {
  it("publishes a non-cacheable readiness response without exposing credentials", async () => {
    const response = await healthCheck();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-diffguard-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toMatchObject({
      status: "ok",
      service: "diffguard",
      capabilities: { deterministicReview: true },
    });
    expect(typeof body.capabilities.hybridReview).toBe("boolean");
    expect(JSON.stringify(body)).not.toContain("GEMINI_API_KEY");
  });

  it("returns request correlation and timing headers for a successful review", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await reviewRequest(new Request("http://localhost/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "review_test_123" },
      body: JSON.stringify({ source: "raw", value: RAW_DIFF }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-diffguard-request-id")).toBe("review_test_123");
    expect(response.headers.get("server-timing")).toMatch(/^total;dur=\d+$/);
    const record = JSON.parse(String(info.mock.calls[0][0]));
    expect(record).toMatchObject({
      service: "diffguard",
      event: "review.completed",
      requestId: "review_test_123",
      source: "raw",
    });
    expect(JSON.stringify(record)).not.toContain("export const value");
  });

  it("runs the seeded demo without a model request or rate-limit charge", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await reviewRequest(new Request("http://localhost/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "invalid_test_123" },
      body: JSON.stringify({ source: "demo" }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-diffguard-request-id")).toBe("invalid_test_123");
    expect(response.headers.get("ratelimit-limit")).toBeNull();
    expect(await response.json()).toMatchObject({
      source: { kind: "demo", label: "Seeded vulnerable demo" },
      analysisMode: "deterministic",
      aiReview: { mode: "fixture", trace: { rawCount: 5, approvedCount: 1, rejectedCount: 4 } },
    });
    expect(JSON.parse(String(info.mock.calls[0][0]))).toMatchObject({ event: "review.completed", source: "demo" });
  });

  it("limits repeated public review requests without storing the client address", async () => {
    vi.stubEnv("DIFFGUARD_RATE_LIMIT_MAX", "2");
    vi.stubEnv("DIFFGUARD_RATE_LIMIT_WINDOW_SECONDS", "60");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = () => reviewRequest(new Request("http://localhost/api/review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.10",
        "X-Request-Id": "rate_limit_test_123",
      },
      body: JSON.stringify({ source: "raw", value: RAW_DIFF }),
    }));

    const first = await request();
    const second = await request();
    const blocked = await request();

    expect(first.status).toBe(200);
    expect(first.headers.get("ratelimit-remaining")).toBe("1");
    expect(second.status).toBe(200);
    expect(second.headers.get("ratelimit-remaining")).toBe("0");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(await blocked.json()).toEqual({ error: "Review limit reached. Try again after the retry window." });
    expect(JSON.parse(String(error.mock.calls.at(-1)?.[0]))).toMatchObject({
      event: "review.failed",
      failureType: "rate_limit",
      statusCode: 429,
    });
    expect(info).toHaveBeenCalledTimes(2);
  });

  it("configures browser security headers globally", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const headers = Object.fromEntries(rules[0].headers.map((header) => [header.key, header.value]));

    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });
});
