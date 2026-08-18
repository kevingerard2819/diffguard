import { describe, expect, it, vi } from "vitest";
import {
  fetchPublicPullRequestDiff,
  GitHubFetchError,
  parsePublicGitHubPullRequestUrl,
} from "@/lib/github";

const VALID_DIFF = `diff --git a/src/value.ts b/src/value.ts
--- a/src/value.ts
+++ b/src/value.ts
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;`;

describe("public GitHub pull-request ingestion", () => {
  it("accepts only a strict public pull-request URL", () => {
    expect(parsePublicGitHubPullRequestUrl("https://github.com/openai/openai-node/pull/123")).toEqual({
      owner: "openai",
      repo: "openai-node",
      pullNumber: 123,
    });
    expect(() => parsePublicGitHubPullRequestUrl("https://github.com/openai/openai-node")).toThrow(/pull\/123/);
    expect(() => parsePublicGitHubPullRequestUrl("https://example.com/openai/openai-node/pull/123")).toThrow(/Only public/);
  });

  it("retries one transient GitHub failure and then validates the diff", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(new Response(VALID_DIFF, { status: 200 }));
    const pause = vi.fn(async () => undefined);

    const result = await fetchPublicPullRequestDiff(
      "https://github.com/openai/openai-node/pull/123",
      { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: pause },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledWith(350);
    expect(result).toEqual({ diff: VALID_DIFF, label: "openai/openai-node #123" });
  });

  it("caps a server-requested retry delay", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "Retry-After": "30" } }))
      .mockResolvedValueOnce(new Response(VALID_DIFF, { status: 200 }));
    const pause = vi.fn(async () => undefined);

    await fetchPublicPullRequestDiff(
      "https://github.com/openai/openai-node/pull/123",
      { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: pause },
    );

    expect(pause).toHaveBeenCalledWith(1_500);
  });

  it("does not retry a missing pull request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));

    await expect(fetchPublicPullRequestDiff(
      "https://github.com/openai/openai-node/pull/999999",
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<GitHubFetchError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
