import { describe, expect, it } from "vitest";
import type { Finding } from "@/lib/domain";
import {
  answerFindingQuestion,
  ASSISTANT_QUESTIONS,
  formatAssistantAnswer,
} from "@/lib/review-assistant";

const finding: Finding = {
  id: "det-dg-sql-001",
  ruleId: "DG-SQL-001",
  title: "SQL injection through string-built query",
  description: "Untrusted data is interpolated into SQL text.",
  category: "security",
  severity: "critical",
  confidence: 0.98,
  evidence: [{
    lineId: "DG-F1-H1-L3",
    filePath: "src/api/invoices.ts",
    newLine: 31,
    code: "const query = `SELECT * FROM invoices WHERE id = ${id}`;",
    reason: "The deterministic rule matched this added line.",
  }],
  suggestedFix: "Use a parameterized query and validate the identifier.",
  recommendedTests: [
    "Send a normal identifier and assert the expected record is returned.",
    "Send a SQL metacharacter payload and assert it is rejected.",
  ],
  source: "deterministic",
};

describe("grounded finding assistant", () => {
  it("offers the five bounded questions", () => {
    expect(ASSISTANT_QUESTIONS.map((item) => item.id)).toEqual([
      "priority",
      "explain",
      "safer-approach",
      "tests",
      "checklist",
    ]);
  });

  it("prioritizes a critical finding using its validated location", () => {
    const answer = answerFindingQuestion(finding, "priority");
    expect(answer.heading).toBe("Address this before merge");
    expect(answer.summary).toContain("98% confidence");
    expect(answer.bullets[0]).toContain("src/api/invoices.ts:31 (DG-F1-H1-L3)");
  });

  it("returns existing recommended tests without inventing replacements", () => {
    const answer = answerFindingQuestion(finding, "tests");
    expect(answer.bullets).toEqual(finding.recommendedTests);
    expect(answer.grounding).toContain("DG-SQL-001");
  });

  it("formats a copyable response with an explicit grounding note", () => {
    const text = formatAssistantAnswer(answerFindingQuestion(finding, "explain"));
    expect(text).toContain("Why DiffGuard raised this");
    expect(text).toContain("The deterministic rule matched this added line.");
    expect(text).toContain("Grounding:");
  });
});
