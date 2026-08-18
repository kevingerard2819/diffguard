"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DiffFile, Finding, ReviewResult } from "@/lib/domain";
import {
  answerFindingQuestion,
  ASSISTANT_QUESTIONS,
  formatAssistantAnswer,
  type AssistantQuestionId,
} from "@/lib/review-assistant";

type InputSource = "github" | "raw";

const INPUT_COPY: Record<
  InputSource,
  { button: string; helper: string; label: string; format: string }
> = {
  github: {
    button: "Review pull request",
    helper: "Public repositories only; the server constructs the GitHub API request safely.",
    label: "Public GitHub pull request",
    format: "Must include /pull/123",
  },
  raw: {
    button: "Review raw diff",
    helper: "Paste a public or non-sensitive unified diff up to 500 KB. Source content is always untrusted data.",
    label: "Unified git diff",
    format: "Starts with diff --git",
  },
};

const REVIEW_STAGES = [
  "Reading and parsing the diff",
  "Assigning trusted evidence lines",
  "Running security and quality checks",
  "Validating supported findings",
] as const;

type ReportAction = "idle" | "copied" | "downloaded" | "failed";

function buildReviewSummary(result: ReviewResult): string {
  const findings = result.findings.length
    ? result.findings.map(
        (finding, index) =>
          `${index + 1}. [${finding.severity.toUpperCase()}] ${finding.title}\n` +
          `   ${finding.evidence[0]?.filePath ?? "unknown file"}:${finding.evidence[0]?.newLine ?? "changed line"} · confidence ${Math.round(finding.confidence * 100)}%\n` +
          `   ${finding.description}`,
      )
    : ["No supported findings were returned."];

  return [
    `DiffGuard review ${result.reviewId}`,
    `Risk: ${result.riskLevel.toUpperCase()} (${result.riskScore}/100)`,
    `Analysis: ${result.analysisMode === "hybrid" ? "Deterministic checks + Gemini" : "Deterministic checks"}`,
    `Files: ${result.summary.filesChanged} · Added lines: ${result.summary.additions} · Findings: ${result.findings.length}`,
    `Evidence coverage: ${Math.round(result.guardrails.evidenceCoverage * 100)}%`,
    "",
    "Findings",
    ...findings,
    "",
    "DiffGuard reviews changed code only; a clear result is not a guarantee that the repository is vulnerability-free.",
  ].join("\n");
}

function severityRank(severity: Finding["severity"]): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity];
}

function DiffViewer({ file, highlightedLineId }: { file: DiffFile; highlightedLineId?: string }) {
  return (
    <article className="panel diffPanel">
      <header className="panelHeader">
        <div><p className="eyebrow">Changed file</p><h2>{file.path}</h2></div>
        <span className="changeCount">+{file.additions} -{file.deletions}</span>
      </header>
      <div className="codeFrame" aria-label={`Diff for ${file.path}`}>
        {file.hunks.flatMap((hunk) => hunk.lines).map((line) => (
          <div
            className={`codeLine ${line.kind} ${highlightedLineId === line.id ? "highlighted" : ""}`}
            key={line.id}
            id={line.id}
          >
            <span>{line.oldLine ?? ""}</span><span>{line.newLine ?? ""}</span>
            <code><b>{line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}</b>{line.content}</code>
            <small title="Server-assigned trusted line ID">{line.id}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

function FindingAssistant({ finding }: { finding: Finding }) {
  const [question, setQuestion] = useState<AssistantQuestionId>("priority");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const answer = answerFindingQuestion(finding, question);

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(formatAssistantAnswer(answer));
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1_600);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section className="findingAssistant" aria-label="Ask DiffGuard">
      <header>
        <span className="assistantMark">DG</span>
        <div><b>Ask DiffGuard</b><small>Grounded in this validated finding</small></div>
        <span className="assistantMode">no extra model call</span>
      </header>
      <div className="assistantPrompts" role="tablist" aria-label="Ask DiffGuard questions">
        {ASSISTANT_QUESTIONS.map((item) => (
          <button
            key={item.id}
            className={question === item.id ? "active" : ""}
            role="tab"
            aria-selected={question === item.id}
            onClick={() => { setQuestion(item.id); setCopyState("idle"); }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="assistantAnswer" role="tabpanel" aria-live="polite">
        <div className="assistantBubble">
          <span>DiffGuard</span>
          <h3>{answer.heading}</h3>
          <p>{answer.summary}</p>
          <ul>{answer.bullets.map((item) => <li key={item}>{item}</li>)}</ul>
          <small>{answer.grounding}</small>
        </div>
        <button className="copyAnswer" onClick={() => void copyAnswer()}>
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy response"}
        </button>
      </div>
    </section>
  );
}

function FindingDetail({ finding }: { finding: Finding }) {
  return (
    <article className={`panel findingPanel severity-${finding.severity}`}>
      <header className="findingTop">
        <div className="severityIcon">!</div>
        <div><span className="severityBadge">{finding.severity}</span><span className="confidence">{Math.round(finding.confidence * 100)}% confidence</span></div>
        <span className="sourceBadge">{finding.source === "llm" ? "AI grounded" : "deterministic"}</span>
      </header>
      <h2>{finding.title}</h2>
      <p>{finding.description}</p>
      <div className="evidenceBox">
        <div><span>Exact evidence</span><b>{finding.source === "llm" ? "ID + quote verified" : "rule matched"}</b></div>
        {finding.evidence.map((item) => (
          <code key={item.lineId}>
            <em>{item.filePath}:{item.newLine ?? "deleted"}</em>{item.code}<small>{item.lineId}</small>
          </code>
        ))}
      </div>
      <div className="recommendation">
        <span>Suggested fix</span><p>{finding.suggestedFix}</p>
      </div>
      <details className="testsBlock">
        <summary>Recommended tests ({finding.recommendedTests.length})</summary>
        <ul>{finding.recommendedTests.map((test) => <li key={test}>{test}</li>)}</ul>
      </details>
      <FindingAssistant finding={finding} />
      <footer><span>{finding.ruleId}</span><span>{finding.category}</span></footer>
    </article>
  );
}

function BoundaryInspector({ result }: { result: ReviewResult }) {
  const [view, setView] = useState<"guarded" | "raw">("guarded");
  const boundary = result.aiReview;
  const fixture = boundary.mode === "fixture";

  return (
    <section className="boundaryInspector" aria-label="Raw AI and guarded review comparison">
      <header>
        <div>
          <p className="eyebrow">Model boundary</p>
          <h2>Raw candidates vs. guarded review</h2>
          <p>{fixture
            ? "Seeded adversarial candidates exercise the real validation code; they are not attributed to a live model."
              : boundary.mode === "live"
              ? "Live Gemini candidates are preserved before citation checks and scoring."
              : "Run a GitHub or raw-diff review with a server-side API key to populate live candidates."}</p>
        </div>
        <span className={`boundaryMode ${fixture ? "fixture" : ""}`}>
          {fixture ? "seeded fixture" : boundary.mode === "live" ? "live Gemini" : "model not run"}
        </span>
      </header>

      <div className="boundarySummary" aria-label="AI review trace counts">
        <span><b>{boundary.trace.rawCount}</b> raw</span>
        <span><b>{boundary.trace.approvedCount}</b> approved</span>
        <span><b>{boundary.trace.rejectedCount}</b> rejected</span>
        <span><b>{boundary.trace.injectionSignals}</b> injection signals</span>
      </div>

      <div className="boundaryTabs" role="tablist" aria-label="Model boundary view">
        <button role="tab" aria-selected={view === "guarded"} className={view === "guarded" ? "active" : ""} onClick={() => setView("guarded")}>Guarded review</button>
        <button role="tab" aria-selected={view === "raw"} className={view === "raw" ? "active" : ""} onClick={() => setView("raw")}>Raw AI</button>
      </div>

      {view === "guarded" ? (
        <div className="guardedCandidates">
          {boundary.approvedFindings.map((finding) => (
            <article className="approvedCandidate" key={finding.id}>
              <span>approved</span><div><b>{finding.title}</b><small>{finding.ruleId} · exact quote matched</small></div>
            </article>
          ))}
          {boundary.rejectedFindings.map((rejected, index) => (
            <article className="rejectedCandidate" key={`${rejected.finding.ruleId}-${index}`}>
              <span>rejected</span><div><b>{rejected.finding.title}</b><code>{rejected.reasonCode}</code><small>{rejected.reason}</small></div>
            </article>
          ))}
          {boundary.trace.rawCount === 0 && <div className="boundaryEmpty">No model candidates were generated for this review.</div>}
          <p className="boundaryFootnote">{fixture
            ? "Fixture candidates are isolated from the final finding list and risk score."
            : "Only approved, deduplicated candidates can affect the risk score."}</p>
        </div>
      ) : (
        <div className="rawCandidates">
          {boundary.rawFindings.map((finding, index) => (
            <article key={`${finding.ruleId}-${index}`}>
              <header><b>{finding.title}</b><span>{Math.round(finding.confidence * 100)}%</span></header>
              <small>{finding.ruleId} · {finding.severity}</small>
              {finding.evidence.map((claim) => (
                <code key={`${claim.lineId}-${claim.quote}`}><em>{claim.lineId}</em>{claim.quote || "(empty quote)"}</code>
              ))}
            </article>
          ))}
          {boundary.rawFindings.length === 0 && <div className="boundaryEmpty">Raw model output is empty because the model was not run.</div>}
        </div>
      )}
    </section>
  );
}

export function ReviewWorkbench({ initialResult = null }: { initialResult?: ReviewResult | null }) {
  const [source, setSource] = useState<InputSource>("github");
  const [inputs, setInputs] = useState<Record<InputSource, string>>({ github: "", raw: "" });
  const [result, setResult] = useState<ReviewResult | null>(initialResult);
  const [selectedFindingId, setSelectedFindingId] = useState(initialResult?.findings[0]?.id || "");
  const [selectedFilePath, setSelectedFilePath] = useState(initialResult?.files[0]?.path || "");
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [error, setError] = useState("");
  const [reportAction, setReportAction] = useState<ReportAction>("idle");
  const resultHeadingRef = useRef<HTMLElement | null>(null);
  const shouldFocusResult = useRef(false);
  const value = inputs[source];

  const sortedFindings = useMemo(
    () => result ? [...result.findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity)) : [],
    [result],
  );
  const selectedFinding = sortedFindings.find((finding) => finding.id === selectedFindingId) || sortedFindings[0];
  const evidenceFile = selectedFinding?.evidence[0]?.filePath;
  const selectedFile = result?.files.find((file) => file.path === evidenceFile)
    || result?.files.find((file) => file.path === selectedFilePath)
    || result?.files[0];

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => {
      setLoadingStage((current) => Math.min(current + 1, REVIEW_STAGES.length - 1));
    }, 1_800);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    if (!result || !shouldFocusResult.current) return;
    shouldFocusResult.current = false;
    const timer = window.setTimeout(() => {
      resultHeadingRef.current?.focus({ preventScroll: true });
      resultHeadingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [result]);

  async function analyze(nextSource: InputSource = source) {
    const submittedValue = inputs[nextSource];
    setLoading(true);
    setLoadingStage(0);
    setError("");
    setReportAction("idle");
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: nextSource, value: submittedValue }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Review failed.");
      const nextResult = payload as ReviewResult;
      shouldFocusResult.current = true;
      setResult(nextResult);
      setSelectedFindingId(nextResult.findings[0]?.id || "");
      setSelectedFilePath(nextResult.files[0]?.path || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review failed.");
    } finally {
      setLoading(false);
    }
  }

  function selectSource(nextSource: InputSource) {
    setSource(nextSource);
    setError("");
  }

  function updateValue(nextValue: string) {
    setInputs((current) => ({ ...current, [source]: nextValue }));
    if (error) setError("");
  }

  function focusReviewInput() {
    window.setTimeout(() => document.getElementById("review-input")?.focus(), 0);
  }

  function handleFindingsNavigation(event: React.MouseEvent<HTMLAnchorElement>) {
    if (result) return;
    event.preventDefault();
    focusReviewInput();
  }

  function switchToRawDiff() {
    selectSource("raw");
    focusReviewInput();
  }

  async function copySummary() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildReviewSummary(result));
      setReportAction("copied");
      window.setTimeout(() => setReportAction("idle"), 1_800);
    } catch {
      setReportAction("failed");
    }
  }

  function downloadReport() {
    if (!result) return;
    try {
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `diffguard-${result.reviewId}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setReportAction("downloaded");
      window.setTimeout(() => setReportAction("idle"), 1_800);
    } catch {
      setReportAction("failed");
    }
  }

  const outcomeTitle = result
    ? result.findings.length > 0
      ? `${result.findings.length} evidence-backed ${result.findings.length === 1 ? "issue needs" : "issues need"} attention`
      : "No supported issues found in this change"
    : "";
  const outcomeDescription = result
    ? result.findings.length > 0
      ? "Start with the highest-severity finding. Every item below points to an exact changed line and includes a suggested fix."
      : "The review completed without a high-signal finding. This is a useful signal, not a guarantee that the repository is vulnerability-free."
    : "";

  return (
    <main className="shell">
      <aside className="sidebar">
        <a className="brand" href="#review" aria-label="DiffGuard home"><span className="brandMark">DG</span><span>DiffGuard</span></a>
        <nav aria-label="Primary navigation">
          <a className="navItem active" href="#review"><span>+</span>New review</a>
          <a
            className={`navItem ${result ? "" : "disabled"}`}
            href={result ? "#findings" : "#review"}
            aria-disabled={!result}
            title={result ? "Jump to verified findings" : "Run a review to see findings"}
            onClick={handleFindingsNavigation}
          ><span>!</span>Findings{result && <em>{result.findings.length}</em>}</a>
          <a className="navItem" href="/evaluation"><span>%</span>Evaluation</a>
        </nav>
        <div className="sideStatus">
          <div className="statusRow"><span className="statusDot" />Guardrails active</div>
          <p>AI findings need a server-assigned line ID and an exact matching quote.</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">Evidence-first review</p><h1>Catch risky changes before they merge.</h1></div>
          <div className="topActions">
            <span className="modelBadge"><span /> {result ? (result.analysisMode === "hybrid" ? "Gemini + rules" : "deterministic") : "guardrails ready"}</span>
            <a className="ghostButton" href="/evaluation">View evals</a>
          </div>
        </header>

        <section className="inputCard" id="review" aria-busy={loading}>
          <header className="inputGuide">
            <div>
              <p className="eyebrow">New review</p>
              <h2>Choose what you want DiffGuard to check.</h2>
              <p>Use a public pull request link, or paste a unified diff when you only have the code change.</p>
            </div>
            <ol aria-label="Three review steps">
              <li className="active"><span>1</span>Choose input</li>
              <li><span>2</span>Run review</li>
              <li><span>3</span>Inspect evidence</li>
            </ol>
          </header>
          <div className="inputTabs" role="tablist" aria-label="Review input type">
            {(["github", "raw"] as InputSource[]).map((tab) => (
              <button className={`inputTab ${source === tab ? "active" : ""}`} key={tab} role="tab" aria-selected={source === tab} aria-controls="review-input-panel" disabled={loading} onClick={() => selectSource(tab)}>
                {tab === "github" ? "GitHub PR" : "Raw diff"}
              </button>
            ))}
          </div>
          <div className="inputRow" id="review-input-panel" role="tabpanel">
            <div className="inputField">
              <label htmlFor="review-input"><b>{INPUT_COPY[source].label}</b><span>{INPUT_COPY[source].format}</span></label>
              {source === "github" && (
                <div className="urlInput"><span aria-hidden="true">GH</span>
                  <input id="review-input" aria-describedby="input-helper provider-disclosure" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://github.com/owner/repo/pull/123" value={value} onChange={(event) => updateValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && value.trim() && !loading) void analyze(); }} />
                </div>
              )}
              {source === "raw" && (
                <textarea id="review-input" className="diffInput" aria-describedby="input-helper provider-disclosure" spellCheck={false} placeholder={'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@'} value={value} onChange={(event) => updateValue(event.target.value)} />
              )}
            </div>
            <button className="primaryButton" onClick={() => void analyze()} disabled={loading || !value.trim()}>
              {loading ? <><i className="spinner" />Reviewing...</> : <>{INPUT_COPY[source].button}<span>-&gt;</span></>}
            </button>
          </div>
          <div className="inputMeta" id="input-helper">
            <span>{INPUT_COPY[source].helper}</span>
            <small>{source === "raw" && value ? `${value.length.toLocaleString()} characters` : "Changed lines only"}</small>
          </div>
          <p className="providerDisclosure" id="provider-disclosure">Hybrid reviews send a bounded set of diff lines to Google Gemini. Free-tier data may be used to improve Google products; do not submit private code.</p>
          {loading && (
            <div className="reviewProgress" role="status" aria-live="polite">
              <div className="progressCopy"><span className="progressMark"><i className="spinner" /></span><div><b>Review in progress</b><small>{REVIEW_STAGES[loadingStage]}</small></div></div>
              <div className="progressSteps" aria-hidden="true">
                {REVIEW_STAGES.map((stage, index) => <i key={stage} className={index <= loadingStage ? "active" : ""} />)}
              </div>
              <small>Evidence validation can take a little longer when AI analysis is active.</small>
            </div>
          )}
          {error && (
            <div className="errorBanner" role="alert">
              <div><b>{source === "github" ? "We couldn’t load that pull request." : "We couldn’t review that diff."}</b><span>{error}</span><small>{source === "github" ? "Check that the repository and PR are public, and that the URL ends in /pull/123." : "Check that you pasted a unified git diff beginning with diff --git."}</small></div>
              <div className="errorActions">
                {source === "github" && <button onClick={switchToRawDiff}>Use raw diff instead</button>}
                <button className="dismissError" onClick={() => setError("")} aria-label="Dismiss error">×</button>
              </div>
            </div>
          )}
        </section>

        {result ? (
          <>
            <section
              className={`outcomeCard outcome-${result.riskLevel}`}
              aria-label="Review outcome"
              ref={resultHeadingRef}
              tabIndex={-1}
            >
              <span className="outcomeIcon" aria-hidden="true">{result.findings.length > 0 ? "!" : "✓"}</span>
              <div className="outcomeCopy">
                <p className="eyebrow">Review complete</p>
                <h2>{outcomeTitle}</h2>
                <p>{outcomeDescription}</p>
                <div><span className={`riskPill risk-${result.riskLevel}`}>{result.riskLevel} risk · {result.riskScore}/100</span><span>{result.analysisMode === "hybrid" ? "Gemini + deterministic checks" : "Deterministic checks"}</span></div>
              </div>
              <div className="outcomeActions">
                <button onClick={() => void copySummary()}><span aria-hidden="true">□</span> Copy summary</button>
                <button onClick={downloadReport}><span aria-hidden="true">↓</span> Download JSON</button>
                <small role="status" aria-live="polite">{reportAction === "copied" ? "Summary copied" : reportAction === "downloaded" ? "Report downloaded" : reportAction === "failed" ? "Action failed—please try again" : "Share or save this review"}</small>
              </div>
            </section>

            {result.warnings.length > 0 && <div className="warningBanner" role="status">{result.warnings.join(" ")}</div>}

            <section className="metrics" aria-label="Review summary">
              <article><p>Risk score</p><strong>{result.riskScore}<span>/100</span></strong><small className={result.riskScore > 0 ? "dangerText" : "successText"}>{result.riskLevel} risk</small></article>
              <article><p>Guarded findings</p><strong>{result.findings.length}</strong><small>{result.summary.filesChanged} files changed</small></article>
              <article><p>Evidence coverage</p><strong>{Math.round(result.guardrails.evidenceCoverage * 100)}%</strong><small className="successText">All references validated</small></article>
              <article><p>Trusted lines</p><strong>{result.summary.trustedLineCount}</strong><small>{result.guardrails.promptInjectionSignals} injection signals contained</small></article>
            </section>

            <section className="verificationTrace" aria-label="Review verification pipeline">
              <header>
                <div><p className="eyebrow">Verification trace</p><h2>Every claim crosses the evidence boundary.</h2></div>
                <span className="traceLock"><i />fail closed</span>
              </header>
              <div className="traceSteps">
                <article className="complete"><span>01</span><div><b>Bounded ingest</b><small>{result.summary.filesChanged} files accepted</small></div></article>
                <article className="complete"><span>02</span><div><b>Trusted mapping</b><small>{result.summary.trustedLineCount} IDs assigned</small></div></article>
                <article className="complete"><span>03</span><div><b>Rule baseline</b><small>{result.findings.filter((finding) => finding.source === "deterministic").length} supported findings</small></div></article>
                <article className={result.aiReview.mode !== "not-run" ? "complete" : "standby"}><span>04</span><div><b>Structured AI</b><small>{result.aiReview.mode === "fixture" ? `${result.aiReview.trace.rawCount} seeded candidates` : result.analysisMode === "hybrid" ? `${result.aiReview.trace.rawCount} live candidates` : "standby without API key"}</small></div></article>
                <article className={result.aiReview.trace.rejectedCount > 0 ? "blocked" : "complete"}><span>05</span><div><b>Evidence gate</b><small>{result.aiReview.trace.rawCount > 0 ? `${result.aiReview.trace.approvedCount} approved · ${result.aiReview.trace.rejectedCount} blocked` : "no model claims processed"}</small></div></article>
              </div>
              <p className="traceNote">Diff text remains untrusted throughout the pipeline. Instructions inside code never become reviewer instructions.</p>
            </section>

            <details className="advancedPanel">
              <summary><span><b>Advanced guardrail details</b><small>Inspect accepted and rejected AI evidence claims</small></span><em>Show trace</em></summary>
              <BoundaryInspector result={result} />
            </details>

            <div className="resultMeta"><div><span className="reviewPulse" />Review {result.reviewId} <b>{result.source.label}</b></div><span>+{result.summary.additions} / -{result.summary.deletions}</span></div>

            {result.files.length > 1 && (
              <div className="fileTabs" aria-label="Changed files">
                {result.files.map((file) => <button key={file.path} className={selectedFile?.path === file.path ? "active" : ""} onClick={() => setSelectedFilePath(file.path)}>{file.path}<span>+{file.additions}</span></button>)}
              </div>
            )}

            <section className="reviewGrid" id="findings">
              <div>
                {selectedFile && <DiffViewer file={selectedFile} highlightedLineId={selectedFinding?.evidence[0]?.lineId} />}
                {sortedFindings.length > 1 && (
                  <div className="findingRail" aria-label="Verified findings">
                    {sortedFindings.map((finding) => (
                      <button key={finding.id} className={selectedFinding?.id === finding.id ? "active" : ""} onClick={() => setSelectedFindingId(finding.id)}>
                        <span className={`severityPip ${finding.severity}`} />
                        <span><b>{finding.title}</b><small>{finding.ruleId} - {finding.evidence[0].filePath}</small></span>
                        <em>{Math.round(finding.confidence * 100)}%</em>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedFinding ? <FindingDetail finding={selectedFinding} /> : (
                <article className="panel emptyFinding"><span className="clearIcon">OK</span><h2>No supported findings</h2><p>The checks found no high-signal issue with evidence in this diff. This is not a guarantee that the change is defect-free.</p></article>
              )}
            </section>
          </>
        ) : (
          <section className="reviewEmptyState" aria-label="Start a code review">
            <div className="emptyStateIntro">
              <span className="emptyStateMark">DG</span>
              <p className="eyebrow">Ready for evidence</p>
              <h2>Start with a pull request or unified diff.</h2>
              <p>DiffGuard reviews only the changed code, assigns trusted line IDs, and keeps unsupported AI claims out of the final result.</p>
            </div>
            <div className="emptyStateFlow" aria-label="Review workflow">
              <article><span>01</span><div><b>Ingest</b><small>Public PR or raw diff</small></div></article>
              <article><span>02</span><div><b>Analyze</b><small>Rules and structured AI</small></div></article>
              <article><span>03</span><div><b>Verify</b><small>Exact evidence required</small></div></article>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
