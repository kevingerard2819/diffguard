import { flattenTrustedLines, parseUnifiedDiff } from "@/lib/diff-parser";
import { runDeterministicChecks } from "@/lib/deterministic-review";
import { EVALUATION_FIXTURES } from "@/lib/fixtures";
import { acceptSupportedLlmFindings, validateLlmReview } from "@/lib/guardrails";

const BASE_MODEL_FINDING = {
  ruleId: "LLM-SEC-001",
  title: "Model finding under evaluation",
  description: "A structured model finding used to exercise the trust boundary.",
  category: "security" as const,
  severity: "high" as const,
  confidence: 0.82,
  suggestedFix: "Use the safe implementation.",
  recommendedTests: ["Exercise the hostile input path."],
};

export function runEvaluation() {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let evidenceTotal = 0;
  let evidenceValid = 0;
  const fixtures = EVALUATION_FIXTURES.map((fixture) => {
    const files = parseUnifiedDiff(fixture.diff);
    const trustedIds = new Set(flattenTrustedLines(files).map((line) => line.id));
    const findings = runDeterministicChecks(files);
    const actual = new Set(findings.map((finding) => finding.ruleId));
    const expected = new Set(fixture.expectedRuleIds);
    for (const rule of actual) {
      if (expected.has(rule)) truePositives += 1;
      else falsePositives += 1;
    }
    for (const rule of expected) if (!actual.has(rule)) falseNegatives += 1;
    for (const finding of findings) for (const item of finding.evidence) {
      evidenceTotal += 1;
      if (trustedIds.has(item.lineId)) evidenceValid += 1;
    }
    return {
      ...fixture,
      actualRuleIds: [...actual],
      passed: actual.size === expected.size && [...actual].every((ruleId) => expected.has(ruleId)),
      evidenceValid: findings.every((finding) => finding.evidence.every((item) => trustedIds.has(item.lineId))),
    };
  });

  const injectionFixtures = fixtures.filter((fixture) => fixture.label === "prompt-injection");
  const boundaryFiles = parseUnifiedDiff(EVALUATION_FIXTURES[0].diff);
  const boundaryLines = flattenTrustedLines(boundaryFiles);
  const supportedLine = boundaryLines.find((line) => line.kind === "added");
  if (!supportedLine) throw new Error("The guardrail evaluation requires one trusted added line.");
  const supportedEvidence = [{
    lineId: supportedLine.id,
    quote: supportedLine.content,
    reason: "The cited line is the claimed source of risk.",
  }];

  const guardrailInputs = [
    {
      id: "supported-evidence",
      name: "Assigned ID and exact quote",
      expected: "accepted",
      payload: { findings: [{ ...BASE_MODEL_FINDING, evidence: supportedEvidence }] },
    },
    {
      id: "invented-evidence",
      name: "Invented line reference",
      expected: "UNKNOWN_LINE_ID",
      payload: { findings: [{
        ...BASE_MODEL_FINDING,
        evidence: [{ ...supportedEvidence[0], lineId: "DG-INVENTED-L999" }],
      }] },
    },
    {
      id: "mixed-evidence",
      name: "Mixed valid and invented IDs",
      expected: "UNKNOWN_LINE_ID",
      payload: { findings: [{
        ...BASE_MODEL_FINDING,
        evidence: [supportedEvidence[0], { ...supportedEvidence[0], lineId: "DG-INVENTED-L999" }],
      }] },
    },
    {
      id: "quote-mismatch",
      name: "Real ID with fabricated quote",
      expected: "EVIDENCE_QUOTE_MISMATCH",
      payload: { findings: [{
        ...BASE_MODEL_FINDING,
        evidence: [{ ...supportedEvidence[0], quote: "const safe = true;" }],
      }] },
    },
    {
      id: "low-confidence",
      name: "Low-confidence candidate",
      expected: "LOW_CONFIDENCE",
      payload: { findings: [{ ...BASE_MODEL_FINDING, confidence: 0.22, evidence: supportedEvidence }] },
    },
    {
      id: "duplicate-finding",
      name: "Duplicate rule and evidence",
      expected: "DUPLICATE_FINDING",
      payload: { findings: [
        { ...BASE_MODEL_FINDING, evidence: supportedEvidence },
        { ...BASE_MODEL_FINDING, title: "Repeated model claim", evidence: supportedEvidence },
      ] },
    },
    {
      id: "invalid-confidence",
      name: "Out-of-range confidence",
      expected: "INVALID_CONFIDENCE",
      payload: { findings: [{ ...BASE_MODEL_FINDING, confidence: 1.7, evidence: supportedEvidence }] },
    },
    {
      id: "invalid-severity",
      name: "Unsupported severity value",
      expected: "INVALID_SEVERITY",
      payload: { findings: [{ ...BASE_MODEL_FINDING, severity: "urgent", evidence: supportedEvidence }] },
    },
    {
      id: "missing-evidence",
      name: "Empty evidence array",
      expected: "MISSING_EVIDENCE",
      payload: { findings: [{ ...BASE_MODEL_FINDING, evidence: [] }] },
    },
  ] as const;

  const guardrailCases = guardrailInputs.map((fixture) => {
    const validated = validateLlmReview(fixture.payload);
    let observed: string;
    if (!validated.success) {
      observed = validated.reasonCode;
    } else {
      const guarded = acceptSupportedLlmFindings(validated.data, boundaryLines);
      observed = guarded.rejectedFindings[0]?.reasonCode ?? "accepted";
    }
    return { ...fixture, observed, passed: observed === fixture.expected };
  });

  const schemaCases = guardrailCases.filter((fixture) =>
    ["INVALID_SCHEMA", "INVALID_CONFIDENCE", "INVALID_SEVERITY", "MISSING_EVIDENCE"].includes(fixture.expected),
  );
  const evidenceCases = guardrailCases.filter((fixture) =>
    ["UNKNOWN_LINE_ID", "EVIDENCE_QUOTE_MISMATCH"].includes(fixture.expected),
  );
  return {
    metrics: {
      precision: truePositives / Math.max(1, truePositives + falsePositives),
      recall: truePositives / Math.max(1, truePositives + falseNegatives),
      evidenceValidity: evidenceTotal === 0 ? 1 : evidenceValid / evidenceTotal,
      promptInjectionFixturePassRate:
        injectionFixtures.every((fixture) => fixture.passed && fixture.evidenceValid) ? 1 : 0,
      schemaRejection: schemaCases.filter((fixture) => fixture.passed).length / Math.max(1, schemaCases.length),
      unsupportedReferenceRejection:
        evidenceCases.filter((fixture) => fixture.passed).length / Math.max(1, evidenceCases.length),
    },
    fixtures,
    guardrailCases,
  };
}
