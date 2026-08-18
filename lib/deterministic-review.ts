import type { DiffFile, DiffLine, Finding, RiskLevel, Severity } from "@/lib/domain";
import { flattenTrustedLines } from "@/lib/diff-parser";

type Rule = {
  id: string;
  title: string;
  description: string;
  category: Finding["category"];
  severity: Severity;
  confidence: number;
  test: (line: string) => boolean;
  fix: string;
  tests: string[];
};

const RULES: Rule[] = [
  {
    id: "DG-SQL-001",
    title: "Possible string-built SQL query",
    description: "This line builds a SQL-looking statement dynamically. If an interpolated value is untrusted, it may be able to change the query structure.",
    category: "security",
    severity: "high",
    confidence: 0.78,
    test: (line) => /(?:select|insert|update|delete)\b/i.test(line) && /(?:\$\{|\+\s*[a-z_$]|\.format\(|%s)/i.test(line),
    fix: "Use a parameterized query and validate the identifier before it reaches the database layer.",
    tests: [
      "Send a normal identifier and assert the expected record is returned.",
      "Send a SQL metacharacter payload and assert it is rejected without changing the query.",
    ],
  },
  {
    id: "DG-SECRET-001",
    title: "Possible hardcoded credential",
    description: "This line contains a credential-shaped value. Confirm that it is a real secret rather than a fixture or placeholder before rotating and removing it.",
    category: "security",
    severity: "high",
    confidence: 0.82,
    test: (line) => /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'`][A-Za-z0-9_\-/.]{8,}["'`]/i.test(line),
    fix: "Move the value to a managed secret or environment variable and rotate the exposed credential.",
    tests: [
      "Assert startup fails safely when the required secret is missing.",
      "Run a repository secret scan and confirm the credential no longer appears in tracked files.",
    ],
  },
  {
    id: "DG-EXEC-001",
    title: "Dynamic execution primitive introduced",
    description: "The change adds a code or command execution primitive. It becomes exploitable if untrusted values can reach the executed input.",
    category: "security",
    severity: "high",
    confidence: 0.82,
    test: (line) => /\beval\s*\(|new\s+Function\s*\(|\bexecSync\s*\(|child_process\.exec\s*\(/.test(line),
    fix: "Replace dynamic execution with an allowlisted operation and pass arguments through a non-shell API.",
    tests: [
      "Submit shell metacharacters and assert they are handled as inert data.",
      "Verify only explicitly allowlisted operations can be selected.",
    ],
  },
  {
    id: "DG-XSS-001",
    title: "Raw HTML rendering requires validation",
    description: "The change renders raw HTML. Script execution is possible when attacker-controlled markup reaches this sink without effective sanitization.",
    category: "security",
    severity: "high",
    confidence: 0.78,
    test: (line) => /dangerouslySetInnerHTML|\.innerHTML\s*=/.test(line),
    fix: "Render text normally or sanitize HTML with a narrowly configured, well-maintained sanitizer.",
    tests: ["Render a script-tag payload and assert no script executes.", "Render expected formatting and assert approved markup is preserved."],
  },
  {
    id: "DG-CRYPTO-001",
    title: "Weak digest detected; confirm security context",
    description: "The change uses MD5 or SHA-1. These digests are unsuitable for passwords, signatures, or collision-resistant checks, but may be acceptable for non-security checksums.",
    category: "security",
    severity: "medium",
    confidence: 0.72,
    test: (line) => /createHash\s*\(\s*["'](?:md5|sha1)["']\s*\)/i.test(line),
    fix: "Use a purpose-built password hash or a modern digest selected for the actual security requirement.",
    tests: ["Assert legacy values migrate safely and new values use the stronger algorithm."],
  },
];

const INJECTION_PATTERNS = [
  /ignore (?:all |any )?(?:previous|prior) instructions/i,
  /system prompt/i,
  /you are (?:now|an?) /i,
  /do not report (?:this|the)/i,
  /mark (?:this|the change) (?:as )?safe/i,
];

function evidence(line: DiffLine, reason: string): Finding["evidence"] {
  return [{ lineId: line.id, filePath: line.filePath, newLine: line.newLine, code: line.content, reason }];
}

export function findPromptInjectionLines(files: DiffFile[]): DiffLine[] {
  return flattenTrustedLines(files).filter(
    (line) => line.kind === "added" && INJECTION_PATTERNS.some((pattern) => pattern.test(line.content)),
  );
}

export function runDeterministicChecks(files: DiffFile[]): Finding[] {
  const addedLines = flattenTrustedLines(files).filter((line) => line.kind === "added");
  const findings: Finding[] = [];
  for (const line of addedLines) {
    for (const rule of RULES) {
      if (!rule.test(line.content)) continue;
      findings.push({
        id: `det-${rule.id.toLowerCase()}-${line.id.toLowerCase()}`,
        ruleId: rule.id,
        title: rule.title,
        description: rule.description,
        category: rule.category,
        severity: rule.severity,
        confidence: rule.confidence,
        evidence: evidence(line, "The deterministic rule matched this added line."),
        suggestedFix: rule.fix,
        recommendedTests: rule.tests,
        source: "deterministic",
      });
    }
  }
  for (const line of findPromptInjectionLines(files)) {
    findings.push({
      id: `det-dg-ai-001-${line.id.toLowerCase()}`,
      ruleId: "DG-AI-001",
      title: "Reviewer-directed instruction detected in diff",
      description: "The diff contains text matching a reviewer-directed instruction pattern. DiffGuard treats it as untrusted data; this detector does not measure model behavior.",
      category: "ai-safety",
      severity: "medium",
      confidence: 0.86,
      evidence: evidence(line, "This added line matches a prompt-injection phrase."),
      suggestedFix: "Remove reviewer-directed instructions from source comments or fixtures unless they are explicitly required for a security test.",
      recommendedTests: [
        "Keep this fixture in the evaluation suite and assert evidence references remain valid.",
        "Assert the reviewer still reports unrelated deterministic vulnerabilities in the same diff.",
      ],
      source: "deterministic",
    });
  }
  return findings;
}

export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 42,
  high: 26,
  medium: 13,
  low: 5,
};

export const SOURCE_WEIGHTS: Record<Finding["source"], number> = {
  deterministic: 1,
  llm: 0.85,
};

export function deduplicateFindings(findings: Finding[]): Finding[] {
  const exactFindings = new Set<string>();
  const overlapIndexes = new Map<string, number>();
  const unique: Finding[] = [];

  for (const finding of findings) {
    const evidenceIds = finding.evidence.map((item) => item.lineId).sort().join(",");
    const exactKey = `${finding.source}:${finding.ruleId}:${evidenceIds}`;
    if (exactFindings.has(exactKey)) continue;
    exactFindings.add(exactKey);

    const primaryEvidence = finding.evidence[0];
    const overlapKey = primaryEvidence
      ? `${finding.category}:${primaryEvidence.filePath}:${primaryEvidence.newLine ?? primaryEvidence.lineId}`
      : "";
    const overlapIndex = overlapKey ? overlapIndexes.get(overlapKey) : undefined;
    const overlappingFinding = overlapIndex === undefined ? undefined : unique[overlapIndex];

    if (overlapIndex !== undefined && overlappingFinding && overlappingFinding.source !== finding.source) {
      if (finding.source === "deterministic") unique[overlapIndex] = finding;
      continue;
    }

    if (overlapKey && overlapIndex === undefined) overlapIndexes.set(overlapKey, unique.length);
    unique.push(finding);
  }

  return unique;
}

export function scoreFindings(findings: Finding[]): { riskScore: number; riskLevel: RiskLevel } {
  const uniqueFindings = deduplicateFindings(findings);
  if (uniqueFindings.length === 0) return { riskScore: 0, riskLevel: "clear" };
  const riskScore = Math.min(100, Math.max(0, Math.round(uniqueFindings.reduce(
    (total, finding) => total
      + SEVERITY_WEIGHTS[finding.severity]
      * (0.72 + finding.confidence * 0.28)
      * SOURCE_WEIGHTS[finding.source],
    0,
  ))));
  const riskLevel: RiskLevel = riskScore >= 80 ? "critical" : riskScore >= 55 ? "high" : riskScore >= 25 ? "medium" : "low";
  return { riskScore, riskLevel };
}
