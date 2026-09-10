# Multi-Agent Build

A reference architecture for a production-oriented multi-agent software delivery workflow.

## Workflow

`REQUEST -> PLAN -> BUILD -> QA & SECURITY -> FINAL SYNTHESIS`

The system is designed around three narrowly scoped agents controlled by a central orchestrator:

- **System Planner** — turns a user goal into an executable plan, dependencies, acceptance criteria, and risk boundaries.
- **Core Builder** — implements only the approved plan and returns structured artifacts and findings.
- **QA & Security Auditor** — independently validates correctness, security, and production readiness and can block release.

The authoritative architecture and security specification is stored in [`architecture-security-review.json`](./architecture-security-review.json).

## Core design principles

- Least-privilege tool access
- Explicit agent responsibilities
- Schema-validated handoffs
- Auditable workflow state
- Blocking QA and security gates
- Secret isolation and redaction
- Controlled retries, budgets, and timeouts
- Human approval for high-impact production operations

## Recommended architecture

```text
User / Client
     |
     v
API / Request Intake
     |
     v
Orchestrator + Workflow State Machine
     |
     +--> Planner Agent
     |
     +--> Builder Agent --> Tool Gateway --> GitHub / CI / Cloud / DB
     |
     +--> QA & Security Agent
     |
     v
Final Synthesizer
     |
     v
Approved Result + Artifacts + Findings

Supporting services:
- Workflow database
- Artifact/object store
- Secret manager
- Audit log
- Metrics / tracing / structured logs
```

## Workflow states

```text
received
  -> planning
  -> building
  -> qa_review
  -> completed

Any stage may transition to:
  -> blocked
  -> failed
```

Only the orchestrator should be allowed to update the authoritative workflow state.

## Production security baseline

Before production use, implement and verify at minimum:

1. Authentication and per-resource authorization.
2. A centralized tool gateway with scoped credentials and action allowlists.
3. Strict JSON schemas for every agent input/output handoff.
4. Secret-manager integration with log and response redaction.
5. Prompt-injection controls that treat user, retrieved, and agent-generated content as untrusted.
6. Outbound-network restrictions and SSRF protection.
7. Dependency, vulnerability, and secret scanning in CI.
8. Rate, retry, token, concurrency, time, and artifact-size limits.
9. Immutable audit events for privileged operations.
10. A blocking release gate for critical/high security findings.
11. Separate development, staging, and production credentials and environments.
12. Tested rollback and recovery procedures.

## Suggested repository structure

```text
src/
  orchestrator/
  agents/
    planner/
    builder/
    qa/
  tools/
  security/
  schemas/
tests/
docs/
.github/workflows/
```

## Required automated tests

The first implementation should cover:

- Workflow-state transitions
- Agent message schema validation
- Authorization boundaries
- Tool allowlists
- Prompt-injection attempts
- Secret redaction
- Retry and timeout behavior
- Failure paths
- Planner -> Builder -> QA integration
- QA blocking completion
- Dependency and secret scans

## Current status

The repository now contains a concrete **reference architecture and security specification**. It is not yet an implemented or deployed multi-agent runtime.

The next engineering milestone is to create the orchestrator, typed agent contracts, agent modules, secured tool gateway, automated tests, and CI pipeline described in the JSON specification.
