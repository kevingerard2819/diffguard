import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local";

  return NextResponse.json({
    status: "ok",
    service: "diffguard",
    version: commit,
    capabilities: {
      deterministicReview: true,
      hybridReview: Boolean(process.env.GEMINI_API_KEY),
    },
  }, {
    headers: {
      "Cache-Control": "no-store",
      "X-DiffGuard-Request-Id": requestId,
    },
  });
}
