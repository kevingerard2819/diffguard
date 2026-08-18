import type { Finding } from "@/lib/domain";

export const ASSISTANT_QUESTIONS = [
  { id: "priority", label: "What should I fix first?" },
  { id: "explain", label: "Explain this risk" },
  { id: "safer-approach", label: "Safer approach" },
  { id: "tests", label: "Tests to add" },
  { id: "checklist", label: "Implementation checklist" },
] as const;

export type AssistantQuestionId = (typeof ASSISTANT_QUESTIONS)[number]["id"];

export type AssistantAnswer = {
  heading: string;
  summary: string;
  bullets: string[];
  grounding: string;
};

function evidenceLocation(finding: Finding): string {
  const item = finding.evidence[0];
  return `${item.filePath}:${item.newLine ?? "deleted"} (${item.lineId})`;
}

export function answerFindingQuestion(
  finding: Finding,
  question: AssistantQuestionId,
): AssistantAnswer {
  const location = evidenceLocation(finding);
  const confidence = `${Math.round(finding.confidence * 100)}%`;
  const confidenceKind = finding.source === "deterministic" ? "rule confidence" : "model confidence";

  switch (question) {
    case "priority": {
      const urgent = finding.severity === "critical" || finding.severity === "high";
      return {
        heading: urgent ? "Address this before merge" : "Plan this into the current change",
        summary: `${finding.title} is a ${finding.severity}-severity finding with ${confidence} ${confidenceKind}. ${urgent ? "It should be resolved or explicitly risk-accepted before this pull request merges." : "It should be reviewed alongside the other supported findings before merge."}`,
        bullets: [
          `Start at ${location}.`,
          finding.suggestedFix,
          `Re-run the review after the code and tests change.`,
        ],
        grounding: `Based on ${finding.ruleId}, severity, ${confidenceKind}, and its first validated evidence line.`,
      };
    }
    case "explain":
      return {
        heading: "Why DiffGuard raised this",
        summary: finding.description,
        bullets: finding.evidence.map((item) =>
          `${item.filePath}:${item.newLine ?? "deleted"} — ${item.reason}`,
        ),
        grounding: `Explanation uses ${finding.evidence.length} validated evidence reference${finding.evidence.length === 1 ? "" : "s"}; it does not infer repository-wide data flow.`,
      };
    case "safer-approach":
      return {
        heading: "Safer implementation direction",
        summary: finding.suggestedFix,
        bullets: [
          `Change the behavior at ${location}.`,
          "Keep untrusted input separate from executable code, query structure, credentials, or rendered markup.",
          "Confirm the replacement with the recommended regression tests.",
        ],
        grounding: "This is an implementation direction from the validated finding, not an automatically generated patch.",
      };
    case "tests":
      return {
        heading: `${finding.recommendedTests.length} recommended regression test${finding.recommendedTests.length === 1 ? "" : "s"}`,
        summary: "Add tests that exercise the unsafe path and prove the fix changes observable behavior.",
        bullets: finding.recommendedTests,
        grounding: `Test suggestions come directly from ${finding.ruleId}.`,
      };
    case "checklist":
      return {
        heading: "Before you mark this resolved",
        summary: `Use this checklist for ${finding.title}.`,
        bullets: [
          `Inspect the exact evidence at ${location}.`,
          `Apply the safer direction: ${finding.suggestedFix}`,
          ...finding.recommendedTests.map((test) => `Test: ${test}`),
          "Re-run DiffGuard and confirm this supported finding is gone.",
          "Have a reviewer verify the semantic fix; structural grounding alone is not proof of correctness.",
        ],
        grounding: "Checklist is assembled only from the current validated finding.",
      };
  }
}

export function formatAssistantAnswer(answer: AssistantAnswer): string {
  return [
    answer.heading,
    answer.summary,
    ...answer.bullets.map((item) => `- ${item}`),
    `Grounding: ${answer.grounding}`,
  ].join("\n");
}
