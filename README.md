# Multi-Agent Build

A runnable, dependency-light reference implementation of a secure multi-agent software delivery workflow.

## Workflow

`REQUEST -> PLAN -> BUILD -> QA & SECURITY -> FINAL SYNTHESIS`

The runtime uses three narrowly scoped agents controlled by a central orchestrator:

- **System Planner** — converts a goal into steps, acceptance criteria, and risks.
- **Core Builder** — produces implementation artifacts within the approved plan.
- **QA & Security Auditor** — independently validates the build and can block release.

The architecture and security specification is stored in [`architecture-security-review.json`](./architecture-security-review.json).

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm start -- "Build a secure cloud service"
```

The CLI prints a single structured JSON object containing the workflow status, agent outputs, audit trail, and final synthesized result.

## Implemented controls

- Explicit workflow state machine
- Planner -> Builder -> QA orchestration
- Runtime validation of every agent handoff
- Fail-closed error handling
- QA release gate that blocks completion
- Role-scoped tool gateway with allowlists
- Basic secret redaction for logs/errors
- Audit events for workflow transitions
- Node test suite for success, block, failure, allowlist, and secret-redaction paths
- GitHub Actions CI with syntax checks, tests, and dependency audit

## Repository structure

```text
src/
  index.js          CLI entrypoint
  orchestrator.js   workflow state machine and synthesis
  agents.js         planner, builder, and QA agents
  contracts.js      handoff/state validation
  security.js       redaction and role-scoped tool gateway
tests/
  orchestrator.test.js
.github/workflows/
  ci.yml
architecture-security-review.json
```

## Security model

The runtime follows least privilege and treats agent outputs as untrusted until validated. Agents do not receive direct privileged credentials by default. External actions should be exposed only through `ToolGateway`, with per-role allowlists and narrowly scoped handlers. Critical or high QA/security findings must block completion.

This reference implementation does **not** yet connect to an LLM provider, production database, cloud deployment account, or secret manager. Those integrations should be added behind interfaces rather than embedded directly in agent code.

## Production hardening still required

Before exposing this as a production service, add authentication/authorization, persistent workflow state, immutable audit storage, real secret-manager integration, request/rate/budget limits, outbound-network controls, prompt-injection defenses for retrieved content, production observability, and environment-separated credentials.

## CI

CI runs on pushes to `main` and `feature/**` and on pull requests into `main`. It performs syntax validation, the Node test suite, and a high-severity dependency audit.

## Status

**Runnable reference runtime implemented.** The next milestone is provider adapters and persistence, while preserving the existing contracts and security boundaries.
