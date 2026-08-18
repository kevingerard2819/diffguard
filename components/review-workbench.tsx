"use client";

import { useMemo, useState } from "react";
import type { DiffFile, Finding, ReviewResult } from "@/lib/domain";
import {
  answerFindingQuestion,
  ASSISTANT_QUESTIONS,
  formatAssistantAnswer,
  type AssistantQuestionId,
} from "@/lib/review-assistant";

type InputSource = "github" | "raw";

const INPUT_COPY: Record<InputSource, { button: string; helper: string }> = {
  github: {
    button: "Analyze pull request",
    helper: "Public repositories only; the server constructs the GitHub API request safely.",
  },
  raw: {
    button: "Analyze raw diff",
    helper: "Paste a public or non-sensitive unified diff up to 500 KB. Source content is always untrusted data.",
  },
};

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
  const [value, setValue] = useState("");
  const [result, setResult] = useState<ReviewResult | null>(initialResult);
  const [selectedFindingId, setSelectedFindingId] = useState(initialResult?.findings[0]?.id || "");
  const [selectedFilePath, setSelectedFilePath] = useState(initialResult?.files[0]?.path || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const sortedFindings = useMemo(
    () => result ? [...result.findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity)) : [],
    [result],
  );
  const selectedFinding = sortedFindings.find((finding) => finding.id === selectedFindingId) || sortedFindings[0];
  const evidenceFile = selectedFinding?.evidence[0]?.filePath;
  const selectedFile = result?.files.find((file) => file.path === evidenceFile)
    || result?.files.find((file) => file.path === selectedFilePath)
    || result?.files[0];

  async function analyze(nextSource: InputSource = source) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: nextSource, value }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Review failed.");
      const nextResult = payload as ReviewResult;
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

  return (
    <main className="shell">
      <aside className="sidebar">
        <a className="brand" href="#review" aria-label="DiffGuard home"><span className="brandMark">DG</span><span>DiffGuard</span></a>
        <nav aria-label="Primary navigation">
          <a className="navItem active" href="#review"><span>+</span>New review</a>
          <a className="navItem" href="#findings"><span>!</span>Findings</a>
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
          <div className="inputTabs" role="tablist" aria-label="Review input type">
            {(["github", "raw"] as InputSource[]).map((tab) => (
              <button className={`inputTab ${source === tab ? "active" : ""}`} key={tab} role="tab" aria-selected={source === tab} onClick={() => selectSource(tab)}>
                {tab === "github" ? "GitHub PR" : "Raw diff"}
              </button>
            ))}
          </div>
          <div className="inputRow">
            {source === "github" && (
              <label className="urlInput"><span aria-hidden="true">GH</span>
                <input aria-label="Public GitHub pull request URL" placeholder="https://github.com/owner/repo/pull/123" value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void analyze(); }} />
              </label>
            )}
            {source === "raw" && (
              <textarea className="diffInput" aria-label="Raw unified diff" placeholder={'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@'} value={value} onChange={(event) => setValue(event.target.value)} />
            )}
            <button className="primaryButton" onClick={() => void analyze()} disabled={loading || !value.trim()}>
              {loading ? <><i className="spinner" />Analyzing...</> : <>{INPUT_COPY[source].button}<span>-&gt;</span></>}
            </button>
          </div>
          <div className="inputMeta">
            <span>{INPUT_COPY[source].helper}</span>
          </div>
          <p className="providerDisclosure">Hybrid reviews send a bounded set of diff lines to Google Gemini. Free-tier data may be used to improve Google products; do not submit private code.</p>
          {error && <div className="errorBanner" role="alert"><b>Review stopped.</b> {error}</div>}
        </section>

        {result ? (
          <>
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

            <BoundaryInspector result={result} />

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
