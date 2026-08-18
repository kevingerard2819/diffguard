# DiffGuard: three-minute founding engineer demo

## 0:00-0:30 — Frame the problem

“AI reviewers are useful, but a confident finding is not trustworthy unless it can point to evidence that actually exists in the submitted change. DiffGuard is an evidence-first reviewer: it treats both the diff and the model as untrusted.”

## 0:30-1:20 — Run a real review

1. Submit a prepared public pull-request URL, or paste its unified diff through **Raw diff**.
2. Point out the risk score, trusted-line count, and evidence coverage before opening a finding.
3. Select a finding and show its exact file, line, code, confidence, fix, and recommended tests.
4. Open **Ask DiffGuard**, choose **What should I fix first?**, and show that the response cites the validated line and existing fix rather than starting an unbounded chat.
5. Use the dark verification trace to explain the five stages: bounded ingest, trusted IDs, deterministic baseline, structured AI, and citation integrity.

Key sentence: “Risk is calculated only after evidence validation; an unsupported model claim never affects the score.”

## 1:20-2:15 — Show the differentiator

1. Open **Evaluation**.
2. Show the 15 labeled diffs, including safe hard negatives and renamed/deleted files.
3. Walk through the visible `DG-INVENTED-L999` rejection trace and explain why the invented citation cannot reach the score.
4. Point out the mismatched-quote, duplicate-claim, and low-confidence boundary cases with their reason codes.
5. Show the nine model-boundary cases on the evaluation page.

Key sentence: “Zod checks the shape; the citation gate verifies the server ID and exact quote. That is structural grounding, not proof the model’s interpretation is correct.”

## 2:15-2:45 — Demonstrate product completeness

- Public GitHub PR URL ingestion with a strict GitHub-only URL boundary.
- Raw unified-diff fallback when GitHub rate-limits an unauthenticated request.
- Deterministic operation without an API key and hybrid operation when the key is configured.
- GitHub Actions runs type checks, lint, unit and parser tests, the evaluation harness, and a production build.
- Vercel-ready Node.js route with no database or background worker.

## 2:45-3:00 — Show founding judgment

“I deliberately excluded authentication, private repositories, RAG, memory, and model routing. They add operational surface without proving the central risk: whether AI review claims are supported. The next milestone would be a GitHub App, language-aware data flow, production telemetry, and a larger real-world corpus.”

## Honest limitations to volunteer

- Pattern rules are deliberately high precision, not a complete static analyzer.
- A clear review does not guarantee defect-free code.
- Public GitHub API access is rate-limited without authentication.
- The adversarial boundary fixtures exercise real validation code but are deterministic; run one live hybrid review before the interview when an API key is available.
- The 24-case suite is an initial regression harness, not a real-world accuracy benchmark.
