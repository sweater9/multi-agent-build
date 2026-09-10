# Multi-Agent Build

A runnable, dependency-light reference implementation of a secure multi-agent software delivery workflow.

## Workflow

`REQUEST -> PLAN -> BUILD -> QA & SECURITY -> PR -> CI -> RESUME -> REPAIR (bounded) -> READY FOR HUMAN MERGE`

The runtime uses narrowly scoped agents controlled by a central orchestrator:

- **System Planner** — converts a goal into steps, acceptance criteria, and risks.
- **Core Builder** — produces artifacts and can execute controlled repository changes on an approved feature branch.
- **QA & Security Auditor** — independently validates the build and repository diff and can block release.
- **Delivery Gate** — opens the pull request only after QA approval, checks CI, and never performs the final merge.

The architecture and security specification is stored in [`architecture-security-review.json`](./architecture-security-review.json).

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm start -- "Build a secure cloud service"
```

The CLI prints a structured JSON object containing workflow state, agent outputs, audit events, repair attempts, delivery status, and the final synthesized result.

## Implemented controls

- Explicit workflow state machine
- Planner -> Builder -> QA orchestration
- Bounded Builder -> QA/CI repair loop
- Runtime validation of every agent handoff
- Fail-closed error handling
- Vendor-neutral model provider adapters
- Persistent workflow state with atomic writes
- Role-scoped tool gateway with allowlists
- Controlled repository branch, read, create, update, compare, PR, and CI-status operations
- Forced repository/branch scoping for provider-generated Builder actions
- No direct writes to `main` or `master` through repository handlers
- Diff-aware QA for configured repository workflows
- Pull request creation only after QA approval and a reviewable diff
- CI status must reach a verifiable terminal success state
- Failed CI checks are fed back to Builder for bounded repair
- Pending CI is represented as `awaiting_ci`
- `awaiting_ci` runs can be resumed from persisted state without rerunning Planner or the already-approved build
- Resume reuses the existing pull request instead of creating duplicates
- Repeated resume calls while CI is pending remain idempotent and resumable
- A failed CI result on resume enters the existing bounded repair loop
- Final output uses `ready_for_merge: true` only when both QA and CI pass
- Final merge remains an explicit human approval action
- Basic secret redaction for logs/errors
- Audit events for initial execution and resumed CI checks
- GitHub Actions CI with syntax checks, tests, and dependency audit

## Resumable execution

Each workflow stores its original goal, agent outputs, delivery state, repair count, and audit trail. When CI is still running, execution ends safely with:

```json
{
  "workflow_status": "awaiting_ci",
  "resume_required": true
}
```

A later call to `orchestrator.resume(workflowRunId)` loads the checkpoint and validates that it is still in `awaiting_ci`. It reconstructs the latest Planner, Builder, and QA handoffs from persisted state, reuses the recorded pull request, and asks the Delivery Gate to re-evaluate CI.

If CI is still pending, the same run remains resumable. If CI succeeds, the workflow moves directly to `completed` with `ready_for_merge: true`. If CI fails, the failure is converted into structured `CI Delivery Gate` findings and sent to Builder for the next bounded repair attempt. Terminal and non-`awaiting_ci` runs cannot be resumed.

## Repository execution model

Repository automation is opt-in. A configured target defines:

```json
{
  "repository": "owner/repo",
  "base": "main",
  "branch": "feature/agent-build"
}
```

Provider-generated repository actions cannot override the configured repository or feature branch. Builder changes are restricted to the approved feature branch. QA and the Delivery Gate inspect the base-to-head diff through the same controlled gateway.

## Security model

The runtime follows least privilege and treats user, provider, retrieved, and agent-generated content as untrusted. Privileged actions are exposed only through narrowly scoped handlers and per-role tool allowlists. Repository paths reject traversal attempts, target repositories and branches are explicitly allowlisted, base branches are separately allowlisted, and high/critical QA or CI findings prevent completion.

Production credentials must be supplied externally. No provider or GitHub secret is embedded in the repository. The runtime contains no autonomous merge action.

## Current status

**v0.5.0: resumable CI-aware execution with idempotent PR reuse, bounded repair, and explicit human merge approval.**

Further production hardening should add authentication/authorization for a hosted API, immutable centralized audit storage, a real secret manager, request/rate/token budgets, outbound-network controls, richer prompt-injection defenses, sandboxed build execution, CI log ingestion, webhook-triggered resume, and deployment approval policies.
