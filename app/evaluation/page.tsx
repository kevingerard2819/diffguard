import { runEvaluation } from "@/lib/evaluation";
import Link from "next/link";

function percent(value: number) { return `${Math.round(value * 100)}%`; }

export default function EvaluationPage() {
  const evaluation = runEvaluation();
  const passingFixtures = evaluation.fixtures.filter((fixture) => fixture.passed).length;
  const passingGuardrails = evaluation.guardrailCases.filter((fixture) => fixture.passed).length;
  const passing = passingFixtures + passingGuardrails;
  const total = evaluation.fixtures.length + evaluation.guardrailCases.length;
  return (
    <main className="evalShell">
      <header className="evalTopbar">
        <Link className="brand lightBrand" href="/"><span className="brandMark">DG</span><span>DiffGuard</span></Link>
        <Link className="ghostButton" href="/">Back to reviewer</Link>
      </header>
      <section className="evalHero">
        <p className="eyebrow">Regression gate</p><h1>Guardrails you can measure.</h1>
        <p>Fifteen labeled diffs and nine adversarial model-boundary cases make false positives, prompt injection, malformed output, duplicate claims, low confidence, and citation failures visible in CI.</p>
        <div className="gateStatus"><span />Quality gate passing <b>{passing}/{total} checks</b></div>
      </section>
      <section className="evalMetrics" aria-label="Evaluation metrics">
        <article><span>Precision</span><strong>{percent(evaluation.metrics.precision)}</strong><small>Threshold 80%</small></article>
        <article><span>Recall</span><strong>{percent(evaluation.metrics.recall)}</strong><small>Threshold 80%</small></article>
        <article><span>Evidence validity</span><strong>{percent(evaluation.metrics.evidenceValidity)}</strong><small>Required 100%</small></article>
        <article><span>Injection resistance</span><strong>{percent(evaluation.metrics.injectionResistance)}</strong><small>Required 100%</small></article>
        <article><span>Schema rejection</span><strong>{percent(evaluation.metrics.schemaRejection)}</strong><small>Required 100%</small></article>
        <article><span>Reference rejection</span><strong>{percent(evaluation.metrics.unsupportedReferenceRejection)}</strong><small>Required 100%</small></article>
      </section>

      <section className="guardrailDemo" aria-label="Unsupported evidence rejection trace">
        <header>
          <div><p className="eyebrow">Failure containment</p><h2>An invented citation never reaches the reviewer.</h2></div>
          <span className="blockedBadge">blocked by design</span>
        </header>
        <div className="guardrailFlow">
          <article className="candidateCard">
            <span>Untrusted model candidate</span>
            <code>{`{\n  "ruleId": "LLM-SEC-001",\n  "evidence": [{\n    "lineId": "DG-INVENTED-L999",\n    "quote": "grantAdminAccess();",\n    "reason": "Claimed source."\n  }]\n}`}</code>
          </article>
          <div className="flowCheck"><b>01</b><span>Zod schema</span><strong>valid shape</strong></div>
          <div className="flowCheck"><b>02</b><span>Trusted ID</span><strong className="blockedText">not assigned</strong></div>
          <div className="flowCheck"><b>03</b><span>Exact quote</span><strong>not reached</strong></div>
          <article className="rejectedCard">
            <span>Final disposition</span><strong>Finding rejected</strong>
            <p>Zero unsupported claims are included in the score or displayed as review findings.</p>
          </article>
        </div>
      </section>

      <section className="fixturePanel">
        <header><div><p className="eyebrow">Labeled corpus</p><h2>Security and hard-negative fixtures</h2></div><code>pnpm eval</code></header>
        <div className="fixtureTable" role="table" aria-label="Evaluation fixtures">
          <div className="fixtureRow fixtureHeader" role="row"><span>Fixture</span><span>Label</span><span>Expected</span><span>Observed</span><span>Status</span></div>
          {evaluation.fixtures.map((fixture) => (
            <div className="fixtureRow" role="row" key={fixture.id}>
              <span><b>{fixture.name}</b><small>{fixture.id}</small></span>
              <span><i className={`labelPill ${fixture.label}`}>{fixture.label}</i></span>
              <code>{fixture.expectedRuleIds.join(", ") || "none"}</code><code>{fixture.actualRuleIds.join(", ") || "none"}</code>
              <span className={fixture.passed ? "pass" : "fail"}>{fixture.passed ? "PASS" : "FAIL"}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="fixturePanel boundaryPanel">
        <header><div><p className="eyebrow">Adversarial boundary</p><h2>Structured-output failure cases</h2></div><span>{passingGuardrails}/{evaluation.guardrailCases.length} passing</span></header>
        <div className="boundaryTable" role="table" aria-label="Model boundary fixtures">
          <div className="boundaryRow boundaryHeader" role="row"><span>Case</span><span>Expected</span><span>Observed</span><span>Status</span></div>
          {evaluation.guardrailCases.map((fixture) => (
            <div className="boundaryRow" role="row" key={fixture.id}>
              <span><b>{fixture.name}</b><small>{fixture.id}</small></span>
              <code>{fixture.expected}</code><code>{fixture.observed}</code>
              <span className={fixture.passed ? "pass" : "fail"}>{fixture.passed ? "PASS" : "FAIL"}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="evalNotes">
        <article><span>01</span><div><h3>Hard-negative baseline</h3><p>Safe SQL, environment secrets, escaped HTML, JSON parsing, and modern hashing expose noisy regressions.</p></div></article>
        <article><span>02</span><div><h3>Citation integrity</h3><p>Every model claim needs both an assigned line ID and an exact quote from that line.</p></div></article>
        <article><span>03</span><div><h3>Initial harness, not a benchmark</h3><p>Malformed schemas, invented IDs, quote mismatches, duplicates, and low-confidence output become explicit CI failures; this small corpus does not prove real-world accuracy.</p></div></article>
      </section>
    </main>
  );
}
