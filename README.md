# Multi-Agent Build

A runnable, dependency-light reference implementation of a secure multi-agent software delivery workflow.

## Workflow

`REQUEST -> PLAN -> BUILD -> QA & SECURITY -> PR -> CI -> SIGNED EVENT RESUME -> REPAIR (bounded) -> READY FOR HUMAN MERGE`

The runtime uses narrowly scoped agents controlled by a central orchestrator:

- **System Planner** — converts a goal into steps, acceptance criteria, and risks.
- **Core Builder** — produces artifacts and can execute controlled repository changes on an approved feature branch.
- **QA & Security Auditor** — independently validates the build and repository diff and can block release.
- **Delivery Gate** — opens the pull request only after QA approval, checks CI, and never performs the final merge.
- **GitHub Workflow Event Handler** — accepts signed `workflow_run` completion events and resumes matching saved workflows.

The architecture and security specification is stored in [`architecture-security-review.json`](./architecture-security-review.json).

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm start -- "Build a secure cloud service"
```

## Implemented controls

- Explicit workflow state machine
- Planner -> Builder -> QA orchestration
- Bounded Builder -> QA/CI repair loop
- Runtime validation of agent handoffs
- Persistent workflow state with atomic writes
- Resumable `awaiting_ci` checkpoints
- Vendor-neutral model provider adapters
- Controlled repository branch, file, diff, PR, and CI-status operations
- No direct writes to `main` or `master` through repository handlers
- Pull request creation only after QA approval and a reviewable diff
- CI must reach a verifiable terminal success state before `ready_for_merge: true`
- Failed CI checks feed back into Builder for bounded repair
- Final merge remains an explicit human approval action
- Signed GitHub webhook verification using HMAC-SHA256
- Durable delivery-ID claims to reject duplicate webhook delivery after process restarts
- Repository + branch matching so unrelated workflow events cannot resume a saved run
- Bounded webhook body size via the HTTP server factory
- Health endpoint for hosted webhook services
- Basic secret redaction for logs/errors
- GitHub Actions CI with syntax checks, tests, and dependency audit

## Event-driven CI resume

When a workflow reaches `awaiting_ci`, its delivery target is persisted:

```json
{
  "delivery": {
    "target": {
      "repository": "owner/repo",
      "base": "main",
      "branch": "feature/agent-build"
    }
  }
}
```

A GitHub `workflow_run` webhook can then resume the matching saved workflow when GitHub reports the run as `completed`. The handler verifies `X-Hub-Signature-256` against a server-side webhook secret, requires a unique `X-GitHub-Delivery` ID, matches the event's repository and head branch to a persisted `awaiting_ci` run, and calls `orchestrator.resume(workflowRunId)`.

Duplicate delivery IDs are claimed atomically and ignored on replay. Events for other repositories, other branches, other event types, or non-completed workflow runs do not resume anything.

`src/webhook-server.js` provides a minimal Node HTTP server factory with `POST /webhooks/github` and `GET /health`. Deployment code must inject the configured orchestrator, state store, and webhook secret; the repository contains no embedded credentials.

## Resumable execution

Each workflow stores its original goal, agent outputs, delivery state, repair count, and audit trail. When CI is still running, execution ends safely with `workflow_status: "awaiting_ci"`. A later resume reuses the recorded pull request and existing Planner/Builder/QA outputs instead of restarting the workflow.

If CI succeeds, the workflow moves directly to `completed` with `ready_for_merge: true`. If CI fails, the failure becomes structured `CI Delivery Gate` feedback for the next bounded Builder repair attempt. Terminal and non-`awaiting_ci` runs cannot be resumed.

## Security model

The runtime follows least privilege and treats user, provider, retrieved, agent-generated, and webhook content as untrusted. Privileged actions are exposed only through narrowly scoped handlers and per-role tool allowlists. Target repositories and branches are explicitly allowlisted, base branches are separately allowlisted, and high/critical QA or CI findings prevent completion.

Production credentials and webhook secrets must be supplied externally. The runtime contains no autonomous merge action.

## Current status

**v0.6.0: event-driven, signed, replay-protected CI resume with persistent target matching and explicit human merge approval.**

Further production hardening should add hosted API authentication/authorization, immutable centralized audit storage, a managed secret store, request/rate/token budgets, richer prompt-injection defenses, sandboxed build execution, detailed CI log ingestion, and deployment approval policies.
