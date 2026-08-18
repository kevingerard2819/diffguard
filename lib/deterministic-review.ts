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
    title: "SQL injection through string-built query",
    description: "Untrusted data appears to be interpolated into a SQL statement, which can let an attacker change the query structure.",
    category: "security",
    severity: "critical",
    confidence: 0.98,
    test: (line) => /(?:select|insert|update|delete)\b/i.test(line) && /(?:\$\{|\+\s*[a-z_$]|\.format\(|%s)/i.test(line),
    fix: "Use a parameterized query and validate the identifier before it reaches the database layer.",
    tests: [
      "Send a normal identifier and assert the expected record is returned.",
      "Send a SQL metacharacter payload and assert it is rejected without changing the query.",
    ],
  },
  {
    id: "DG-SECRET-001",
    title: "Hardcoded credential in source",
    description: "A credential-like value is committed directly in code and could leak through source history, logs, or build artifacts.",
    category: "security",
    severity: "high",
    confidence: 0.94,
    test: (line) => /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'`][A-Za-z0-9_\-/.]{8,}["'`]/i.test(line),
    fix: "Move the value to a managed secret or environment variable and rotate the exposed credential.",
    tests: [
      "Assert startup fails safely when the required secret is missing.",
      "Run a repository secret scan and confirm the credential no longer appears in tracked files.",
    ],
  },
  {
    id: "DG-EXEC-001",
    title: "Dynamic code or command execution",
    description: "The change introduces an execution primitive that can run attacker-controlled code or shell input.",
    category: "security",
    severity: "high",
    confidence: 0.92,
    test: (line) => /\beval\s*\(|new\s+Function\s*\(|\bexecSync\s*\(|child_process\.exec\s*\(/.test(line),
    fix: "Replace dynamic execution with an allowlisted operation and pass arguments through a non-shell API.",
    tests: [
      "Submit shell metacharacters and assert they are handled as inert data.",
      "Verify only explicitly allowlisted operations can be selected.",
    ],
  },
  {
    id: "DG-XSS-001",
    title: "Unescaped HTML rendering",
    description: "Raw HTML is rendered into the page and may execute script when the value contains attacker-controlled markup.",
    category: "security",
    severity: "high",
    confidence: 0.9,
    test: (line) => /dangerouslySetInnerHTML|\.innerHTML\s*=/.test(line),
    fix: "Render text normally or sanitize HTML with a narrowly configured, well-maintained sanitizer.",
    tests: ["Render a script-tag payload and assert no script executes.", "Render expected formatting and assert approved markup is preserved."],
  },
  {
    id: "DG-CRYPTO-001",
    title: "Weak hash used in a security-sensitive path",
    description: "MD5 or SHA-1 is not appropriate for passwords, signatures, or collision-resistant security checks.",
    category: "security",
    severity: "medium",
    confidence: 0.84,
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
      title: "Prompt-injection instruction embedded in diff",
      description: "The diff contains instruction-like text aimed at the reviewer. Diff content is treated as untrusted data and the instruction was not followed.",
      category: "ai-safety",
      severity: "medium",
      confidence: 0.99,
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

function uniqueScoreFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const evidenceIds = finding.evidence.map((item) => item.lineId).sort().join(",");
    const key = `${finding.ruleId}:${evidenceIds}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function scoreFindings(findings: Finding[]): { riskScore: number; riskLevel: RiskLevel } {
  const uniqueFindings = uniqueScoreFindings(findings);
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
