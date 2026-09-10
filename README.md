# Multi-Agent Build

A runnable, dependency-light reference implementation of a secure multi-agent software delivery workflow.

## Workflow

`REQUEST -> PLAN -> BUILD -> QA & SECURITY -> REPAIR (bounded) -> FINAL SYNTHESIS`

The runtime uses three narrowly scoped agents controlled by a central orchestrator:

- **System Planner** — converts a goal into steps, acceptance criteria, and risks.
- **Core Builder** — produces artifacts and can execute controlled repository changes on an approved feature branch.
- **QA & Security Auditor** — independently validates the build, can inspect the repository diff, and can block release.

The architecture and security specification is stored in [`architecture-security-review.json`](./architecture-security-review.json).

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm start -- "Build a secure cloud service"
```

The CLI prints a single structured JSON object containing workflow state, agent outputs, audit events, repair attempts, and the final synthesized result.

## Implemented controls

- Explicit workflow state machine
- Planner -> Builder -> QA orchestration
- Bounded Builder -> QA repair loop
- Runtime validation of every agent handoff
- Fail-closed error handling
- QA release gate that blocks unresolved high/critical findings
- Vendor-neutral model provider adapters
- Persistent workflow state with atomic writes
- Role-scoped tool gateway with allowlists
- Controlled repository branch, read, create, update, and compare operations
- Forced repository/branch scoping for provider-generated Builder actions
- No direct writes to `main` or `master` through repository handlers
- Diff-aware QA for configured repository workflows
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

A failed QA review is fed back to Builder as `previous_qa`. The orchestrator retries only up to `maxRepairAttempts` (default: 2), preventing unbounded autonomous loops.

## Security model

The runtime follows least privilege and treats user, provider, retrieved, and agent-generated content as untrusted. Privileged actions are exposed only through narrowly scoped handlers and per-role tool allowlists. Repository paths reject traversal attempts, target repositories and branches are explicitly allowlisted, and high/critical QA findings prevent completion.

Production credentials must be supplied externally. No provider or GitHub secret is embedded in the repository.

## Current status

**v0.3.0: controlled repository execution + diff-aware QA + bounded repair loop.**

Further production hardening should add authentication/authorization for a hosted API, immutable centralized audit storage, a real secret manager, request/rate/token budgets, outbound-network controls, richer prompt-injection defenses, sandboxed build execution, CI-status ingestion, and explicit human approval before deployment or merge actions.
