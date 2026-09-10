# Multi-Agent Build

A runnable, dependency-light reference implementation of a secure multi-agent software delivery workflow.

## Workflow

`REQUEST -> PLAN -> BUILD -> QA & SECURITY -> PR -> CI -> REPAIR (bounded) -> READY FOR HUMAN MERGE`

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

The CLI prints a single structured JSON object containing workflow state, agent outputs, audit events, repair attempts, delivery status, and the final synthesized result.

## Implemented controls

- Explicit workflow state machine
- Planner -> Builder -> QA orchestration
- Bounded Builder -> QA/CI repair loop
- Runtime validation of every agent handoff
- Fail-closed error handling
- QA release gate that blocks unresolved high/critical findings
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
- Pending CI is represented as `awaiting_ci`, not falsely reported as success or failure
- Final output uses `ready_for_merge: true` only when both QA and CI pass
- Final merge remains an explicit human approval action
- Basic secret redaction for logs/errors
- Audit events for workflow transitions
- GitHub Actions CI with syntax checks, tests, and dependency audit

## Repository execution model

Repository automation is opt-in. A configured target defines:

```json
{
  "repository": "owner/repo",
  "base": "main",
  "branch": "feature/agent-build"
}
```

Provider-generated repository actions cannot override the configured repository or feature branch. The Builder may create the approved branch and create/update approved paths through `ToolGateway`. QA reads the base-to-head comparison through the same gateway. If no reviewable diff exists, the default QA gate blocks the workflow.

After QA approves a build, the Delivery Gate verifies the diff, opens the pull request, and reads CI status through a dedicated `release` role. CI failure becomes structured feedback for the next Builder attempt. The orchestrator retries only up to `maxRepairAttempts` (default: 2), preventing unbounded autonomous loops.

If CI is still queued or running, the workflow returns `awaiting_ci`. If CI passes, the workflow completes with `ready_for_merge: true` and `merge_requires_human_approval: true`. The runtime contains no autonomous merge action.

## Security model

The runtime follows least privilege and treats user, provider, retrieved, and agent-generated content as untrusted. Privileged actions are exposed only through narrowly scoped handlers and per-role tool allowlists. Repository paths reject traversal attempts, target repositories and branches are explicitly allowlisted, base branches are separately allowlisted, and high/critical QA or CI findings prevent completion.

Production credentials must be supplied externally. No provider or GitHub secret is embedded in the repository.

## Current status

**v0.4.0: CI-aware pull-request delivery with bounded repair and explicit human merge approval.**

Further production hardening should add authentication/authorization for a hosted API, immutable centralized audit storage, a real secret manager, request/rate/token budgets, outbound-network controls, richer prompt-injection defenses, sandboxed build execution, CI log ingestion, resumable `awaiting_ci` runs, and deployment approval policies.
