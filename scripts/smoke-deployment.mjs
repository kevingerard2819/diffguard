import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function healthEndpoint(value) {
  let base;
  try {
    base = new URL(String(value));
  } catch {
    throw new Error("DEPLOYMENT_URL must be a valid URL.");
  }
  const local = base.hostname === "localhost" || base.hostname === "127.0.0.1";
  if (base.protocol !== "https:" && !(local && base.protocol === "http:")) {
    throw new Error("DEPLOYMENT_URL must use HTTPS (HTTP is allowed only for localhost)." );
  }
  return new URL("/api/health", base);
}

const wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

export async function main() {
  const endpoint = healthEndpoint(process.env.DEPLOYMENT_URL);
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        headers: { "User-Agent": "diffguard-deployment-smoke-test" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}.`);
      const body = await response.json();
      if (body?.status !== "ok" || body?.service !== "diffguard" || body?.capabilities?.deterministicReview !== true) {
        throw new Error("Health endpoint returned an unexpected readiness contract.");
      }
      const summary = [
        "## DiffGuard deployment smoke test",
        "",
        `- Status: **healthy**`,
        `- Version: \`${String(body.version || "unknown").replace(/[`\r\n]/g, "")}\``,
        `- Deterministic review: **ready**`,
        `- Hybrid review: **${body.capabilities.hybridReview ? "ready" : "not configured"}**`,
      ].join("\n");
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, "utf8");
      console.log(`DiffGuard deployment is healthy (${body.version || "unknown"}).`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await wait(attempt * 2_000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Deployment smoke test failed.");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`::error::${String(error instanceof Error ? error.message : "Deployment smoke test failed").replace(/[\r\n]/g, " ")}`);
    process.exitCode = 1;
  });
}

