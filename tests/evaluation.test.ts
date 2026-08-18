import { describe, expect, it } from "vitest";
import { runEvaluation } from "@/lib/evaluation";

describe("DiffGuard quality gate", () => {
  const evaluation = runEvaluation();

  it("keeps precision and recall above the MVP threshold", () => {
    expect(evaluation.metrics.precision).toBeGreaterThanOrEqual(0.8);
    expect(evaluation.metrics.recall).toBeGreaterThanOrEqual(0.8);
  });

  it("requires every evidence reference to resolve", () => {
    expect(evaluation.metrics.evidenceValidity).toBe(1);
  });

  it("detects every labeled reviewer-directed prompt-injection fixture", () => {
    expect(evaluation.metrics.promptInjectionFixturePassRate).toBe(1);
  });

  it("rejects malformed schemas and unsupported evidence", () => {
    expect(evaluation.metrics.schemaRejection).toBe(1);
    expect(evaluation.metrics.unsupportedReferenceRejection).toBe(1);
    expect(evaluation.guardrailCases.filter((fixture) => !fixture.passed)).toEqual([]);
    expect(evaluation.guardrailCases).toHaveLength(9);
  });

  it("passes every labeled fixture", () => {
    expect(evaluation.fixtures).toHaveLength(15);
    expect(evaluation.fixtures.filter((fixture) => !fixture.passed)).toEqual([]);
  });
});
