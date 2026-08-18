import { describe, expect, it } from "vitest";
import type { DiffLine } from "@/lib/domain";
import {
  buildGeminiReviewRequest,
  DEFAULT_GEMINI_MODEL,
  MAX_MODEL_DIFF_CHARACTERS,
  parseGeminiReviewOutput,
  selectModelLines,
} from "@/lib/gemini-review";

const trustedLine: DiffLine = {
  id: "DG-F1-H1-L1",
  kind: "added",
  content: "execute(userInput);",
  oldLine: null,
  newLine: 1,
  filePath: "src/runner.ts",
};

describe("Gemini review boundary", () => {
  it("caps model input while preserving complete trusted lines", () => {
    const lines: DiffLine[] = Array.from({ length: 120 }, (_, index) => ({
      id: `DG-F1-H1-L${index + 1}`,
      kind: "added",
      content: "x".repeat(1_000),
      oldLine: null,
      newLine: index + 1,
      filePath: "src/large-generated-file.ts",
    }));
    const result = selectModelLines(lines);
    const estimatedSize = result.lines.reduce(
      (total, line) => total + line.id.length + line.filePath.length + line.content.length + 32,
      0,
    );
    expect(result.truncated).toBe(true);
    expect(result.lines.length).toBeGreaterThan(0);
    expect(estimatedSize).toBeLessThanOrEqual(MAX_MODEL_DIFF_CHARACTERS);
    expect(result.lines.at(-1)?.content).toHaveLength(1_000);
  });

  it("builds a stateless structured request with the diff isolated as untrusted data", () => {
    const request = buildGeminiReviewRequest([trustedLine]);
    expect(request).toMatchObject({
      model: DEFAULT_GEMINI_MODEL,
      store: false,
      response_format: { type: "text", mime_type: "application/json" },
      generation_config: { max_output_tokens: 4_000, thinking_level: "low" },
    });
    expect(request.system_instruction).toContain("untrusted data");
    expect(request.input).toContain("<UNTRUSTED_DIFF>");
    expect(request.input).toContain("[DG-F1-H1-L1]");
    expect(request.input).toContain(trustedLine.content);
  });

  it("parses valid JSON through the Zod contract", () => {
    const result = parseGeminiReviewOutput(JSON.stringify({ findings: [{
      ruleId: "LLM-EXEC-001",
      title: "Untrusted dynamic execution",
      description: "User-controlled input reaches a dynamic execution primitive.",
      category: "security",
      severity: "high",
      confidence: 0.9,
      evidence: [{
        lineId: trustedLine.id,
        quote: trustedLine.content,
        reason: "The added line executes the supplied value.",
      }],
      suggestedFix: "Replace dynamic execution with an allowlisted operation.",
      recommendedTests: ["Verify untrusted input cannot select executable code."],
    }] }));
    expect(result.findings[0]).toMatchObject({ ruleId: "LLM-EXEC-001", confidence: 0.9 });
  });

  it("fails closed on invalid JSON and invalid structured output", () => {
    expect(() => parseGeminiReviewOutput("not json")).toThrow("invalid JSON");
    expect(() => parseGeminiReviewOutput(JSON.stringify({ findings: [{ severity: "urgent" }] })))
      .toThrow("failed Zod validation");
  });
});
