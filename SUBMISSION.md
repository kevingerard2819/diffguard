# Founding AI Engineer assignment — DiffGuard

## What I built and why

I built **DiffGuard**, an evidence-first AI code reviewer for public GitHub pull requests and raw Git diffs.

I chose this problem because AI code review has a trust problem. A model can produce a confident, well-written security finding while citing code that does not exist or misunderstanding the changed line. My goal was not to build the largest possible reviewer. It was to prove one important product idea well: a finding should not reach the developer unless it is grounded in exact evidence from the submitted change.

The live product accepts a public PR URL, raw diff, or safe seeded vulnerable demo. It returns a bounded risk score, severity, exact changed lines, suggested fixes, confidence signals, and recommended tests. It also exposes the raw-model-versus-guarded boundary so a reviewer can see what was accepted and rejected.

- Live application: https://diffguard-ten.vercel.app/
- Evaluation dashboard: https://diffguard-ten.vercel.app/evaluation
- GitHub repository: https://github.com/kevingerard2819/diffguard

## How I understand the product context

Superbrain combines an IDE surface, an execution agent, and a proprietary context engine. Its current public positioning also emphasizes terminal and IDE integration, large-repository understanding, approval-controlled execution, and TokenFold's claimed context compression. The product challenge is therefore bigger than generating code: it is helping a developer understand what the agent knows, what it changed, why it changed it, and whether the result is safe to accept.

DiffGuard explores one part of that larger problem. If an agent can move from an issue to a pull request, the review layer needs to make the output inspectable and trustworthy. Evidence-first review is the control point between autonomous execution and human approval.

## Architecture and design

```text
Public PR URL / raw diff / seeded demo
                  ↓
        bounded server ingestion
                  ↓
          unified diff parser
                  ↓
       server-assigned trusted IDs
            ↙             ↘
 deterministic rules    Gemini structured review
            ↘             ↙
        Zod + ID + exact-quote validation
                  ↓
          deduplicate and score
                  ↓
 evidence UI / Ask DiffGuard / JSON / annotations / SARIF
```

The frontend is a Next.js and TypeScript developer dashboard. The backend uses Next.js route handlers. Public GitHub URLs are parsed into strict owner, repository, and PR-number components before the server constructs the GitHub API request. Arbitrary URL fetching is not allowed.

The diff parser accepts bounded text diffs, assigns stable IDs to added, removed, and context lines, and rejects binary, oversized, or excessive-file changes. Deterministic checks provide a repeatable security baseline. Gemini receives only a bounded set of already-identified lines and must return structured JSON.

Zod validates the model response. A second guardrail rejects evidence when the line ID is unknown, the quote does not exactly match, confidence is too low, or the candidate duplicates an accepted claim. Only final approved findings affect the risk score, GitHub annotations, or SARIF output.

The seeded demo is intentionally deterministic. It demonstrates SQL interpolation, a credential-shaped value, dynamic execution, prompt injection, and four rejection reasons without consuming model quota or pretending that fixture output came from a live model.

## Key decisions

| Decision | Why I made it |
| --- | --- |
| Validate evidence before scoring | Unsupported model claims should never influence the result. |
| Keep deterministic checks beside the model | The product still provides a predictable baseline when the model or quota is unavailable. |
| Review only changed lines | This keeps the MVP explainable and avoids claiming repository-wide data-flow analysis. |
| Use confidence as a signal, not probability | Rule confidence and model confidence are different and neither proves exploitability. |
| Show rejected candidates | A visible trust boundary is more credible than silently claiming the model is safe. |
| Keep Ask DiffGuard grounded and bounded | It helps the user act without introducing another unbounded model conversation or memory system. |
| Exclude private repositories and authentication | They add operational scope without proving the evidence-validation idea. |
| Add JSON, annotations, and SARIF | The reviewer should fit the pull-request workflow, not remain only a dashboard demo. |
| Add a small public rate limit | A student demo should not leave its model quota completely unprotected. |

## Product strategy: what I would add next

For DiffGuard, I would add language-aware rule packs and a larger labeled corpus before adding more AI architecture. TypeScript/JavaScript, Python, Java, Go, and C# should each have explicit evaluation fixtures and data-flow-aware checks. After that I would add a GitHub App for authenticated private-repository access, durable edge rate limiting, and production telemetry.

For Superbrain, I would invest in an **execution evidence timeline**. Every task should show the issue, context selected by the architecture layer, decisions made by the agent, commands executed, files changed, tests run, and unresolved risks in one inspectable chain. The user should be able to ask “why was this file changed?” and receive an answer grounded in that chain. DiffGuard could become the pull-request verification stage in this workflow.

I would also make context efficiency visible. Token savings are valuable, but developers need product-level evidence that compression did not remove an important dependency. A context inspector could show the selected architecture nodes, excluded areas, confidence, and why each part was included.

## Major UI issues I would focus on

The main UI risk in agentic coding products is fragmented trust. The plan may be in chat, execution in a terminal, edits in the IDE, approvals in a modal, and final review on GitHub. That forces the user to reconstruct the agent's reasoning across surfaces.

I would address these issues:

1. **Unclear execution state.** “Working” is not enough. Show whether the agent is reading, planning, editing, testing, waiting for approval, or blocked.
2. **Approval fatigue.** Group related safe actions into a reviewable plan while keeping destructive or external actions explicit.
3. **Large diff overload.** Prioritize semantically important changes, risks, failed tests, and evidence instead of presenting every file equally.
4. **Context opacity.** Show what repository knowledge influenced the answer and what was outside the active context.
5. **Weak failure recovery.** When a command or test fails, preserve the failure, attempted fix, and remaining uncertainty rather than replacing it with a generic retry state.
6. **Confidence without meaning.** Label whether confidence comes from a deterministic rule, model judgment, test result, or verified repository fact.

These concerns directly influenced DiffGuard's UI: it shows pipeline stages, exact evidence, confidence provenance, rejected model candidates, loading/error states, and explicit limitations.

## Execution and quality evidence

The repository includes TypeScript checking, linting, 55+ unit and guardrail tests, a production build, CodeQL, Dependabot configuration, deployment smoke tests, and an evaluation gate. The labeled harness includes vulnerable, prompt-injection, clean, renamed, and deleted-file diffs plus adversarial structured-output cases.

The GitHub Action can emit bounded workflow annotations, produce JSON and SARIF, write a job summary, optionally update one PR comment, and fail at a configured risk threshold. The Vercel deployment exposes a non-secret health contract and returns correlation and timing headers for reviews.

This evaluation corpus is a regression harness, not a benchmark. Passing it does not prove real-world vulnerability coverage.

## What I deliberately left out

I left authentication, private repositories, RAG, long-term memory, model routing, automatic patch application, and a database outside the MVP. Those could all be useful later, but adding them before proving the trust boundary would have made the system broader without making the central idea stronger.

## What I learned

My biggest design lesson was that structured output alone is not enough. A JSON schema can guarantee shape, but it cannot guarantee that a cited line exists or that the quote matches. The strongest part of the implementation is the boundary after the model: trusted server IDs, exact-quote validation, explicit rejection reasons, and scoring only after validation.

I used AI tools to help structure implementation and test edge cases, but the scope, trade-offs, architecture, prioritization, and final decisions are the parts I would defend in the next round.
