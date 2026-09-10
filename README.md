# Multi-Agent Build

A runnable, dependency-light implementation of a secure multi-agent software delivery workflow.

## Workflow

`REQUEST -> PLAN -> BUILD -> QA & SECURITY -> PR -> CI -> SIGNED EVENT RESUME -> REPAIR (bounded) -> READY FOR HUMAN MERGE`

The runtime uses narrowly scoped agents controlled by a central orchestrator:

- **System Planner** — converts a goal into steps, acceptance criteria, and risks.
- **Core Builder** — produces artifacts and can execute controlled repository changes on an approved feature branch.
- **QA & Security Auditor** — independently validates the build and repository diff and can block release.
- **Delivery Gate** — opens the pull request only after QA approval, checks CI, and never performs the final merge.
- **GitHub Workflow Event Handler** — accepts signed `workflow_run` completion events and resumes matching saved workflows.
- **Hosted Service** — exposes authenticated workflow APIs, health/readiness endpoints, and the signed GitHub webhook on one HTTP listener.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm start -- "Build a secure cloud service"
```

Hosted service:

```bash
SERVICE_API_KEY="replace-with-a-long-random-secret" npm run service
```

## Hosted API

Public operational endpoints:

- `GET /health` — process liveness
- `GET /ready` — state-storage/configuration readiness

Bearer-authenticated workflow endpoints:

- `POST /api/workflows` with `{ "goal": "..." }`
- `GET /api/workflows/:workflowRunId`
- `POST /api/workflows/:workflowRunId/resume`

GitHub webhook endpoint:

- `POST /webhooks/github` — independently authenticated with `X-Hub-Signature-256`

The API compares bearer secrets in constant time after hashing. Authenticated API traffic is protected by a per-client sliding-window limiter. Request bodies are bounded, API responses disable caching, and error responses do not expose internal stack traces.

## Repository automation

Repository automation is optional and configured only through environment variables. When enabled, the service creates a `GitHubRestClient`, routes all repository operations through `ToolGateway`, restricts writes to the configured feature branch, and preserves the human-only final merge boundary.

Required variables for repository automation:

- `GITHUB_TOKEN`
- `TARGET_REPOSITORY`
- `TARGET_BRANCH` (defaults to `feature/agent-build`)
- `TARGET_BASE` (defaults to `main`)

The real GitHub client now exposes the same `getCiStatus()` contract expected by repository handlers, eliminating a production-only mock mismatch. CI status records also retain bounded workflow IDs/URLs and the client can retrieve bounded failed-step diagnostics for a selected workflow run.

## Provider network controls

Remote model providers are optional. When configured, HTTPS is required by default, redirects are rejected, response content type must be JSON, response size is bounded, timeout is bounded, and an explicit provider-host allowlist can be supplied.

Variables:

- `AGENT_PROVIDER_URL`
- `AGENT_PROVIDER_API_KEY`
- `AGENT_PROVIDER_TIMEOUT_MS`
- `AGENT_PROVIDER_MAX_RESPONSE_BYTES`
- `AGENT_PROVIDER_ALLOWED_HOSTS` — comma-separated hostname allowlist

Plain HTTP is disabled by default and should only be enabled for controlled local development.

## Durable workflow state

The default file backend remains dependency-free for local development and smoke testing. Production can require durable storage explicitly. When `REQUIRE_DURABLE_STATE=true`, startup fails closed unless `DURABLE_STATE_MOUNT` is configured and `WORKFLOW_STATE_DIR` is inside that mount. `/ready` performs a real write/delete probe.

For a persistent disk mounted at `/var/data`:

```text
WORKFLOW_STATE_BACKEND=file
WORKFLOW_STATE_DIR=/var/data/multi-agent-runs
AUDIT_LOG_DIR=/var/data/multi-agent-runs/audit
DURABLE_STATE_MOUNT=/var/data
REQUIRE_DURABLE_STATE=true
```

## Audit trail

Hosted workflow events are additionally written to an append-only NDJSON audit file with a SHA-256 hash chain. Each entry records the previous entry hash, making accidental or unauthorized historical modification detectable. Audit storage inherits the durability characteristics of its configured directory.

Recorded service events include authentication failures, rate-limit events, workflow starts/resumes, and GitHub webhook acceptance outcomes. Secrets and bearer tokens are not written into these records.

## Implemented controls

- Explicit workflow state machine and bounded Builder -> QA/CI repair loop
- Runtime validation of agent handoffs
- Persistent/resumable `awaiting_ci` checkpoints
- Fail-closed durable-state configuration gate
- Readiness write/delete probe for state storage
- Per-client API request limiting with `429` + `Retry-After`
- Hash-chained append-only audit records
- HTTPS-only remote provider endpoints by default
- Provider host allowlist, redirect rejection, response-size/content-type/timeout bounds
- Controlled repository branch, file, diff, PR, and CI-status operations
- Real GitHub client/repository-handler CI contract alignment
- Bounded CI failed-step diagnostic hook
- No direct writes to `main` or `master` through agent repository handlers
- CI must reach terminal success before `ready_for_merge: true`
- Failed CI checks feed back into Builder for bounded repair
- Final merge remains explicit human approval
- Signed GitHub webhook verification using HMAC-SHA256
- Durable delivery-ID replay protection when the configured state backend is durable
- Repository + branch matching for event-driven resume
- Bearer authentication for workflow APIs
- Public liveness and readiness endpoints
- Bounded HTTP request bodies and no-store API responses
- Basic secret redaction for logs/errors
- GitHub Actions CI with syntax checks, tests, and dependency audit

## Render deployment

`render.yaml` provides a Frankfurt Node web-service blueprint using `npm run service` and `/health` as the service health check.

The free-plan deployment intentionally remains smoke-test mode under `/tmp/multi-agent-runs`. For production durability, attach a persistent disk and switch the state/audit paths under its mount with `REQUIRE_DURABLE_STATE=true`.

## Security model

The runtime follows least privilege and treats user, provider, retrieved, agent-generated, webhook, and CI content as untrusted. Privileged actions are exposed only through narrowly scoped handlers and per-role tool allowlists. Target repositories and branches are explicitly allowlisted, base branches are separately allowlisted, and high/critical QA or CI findings prevent completion.

Production credentials and webhook secrets must be supplied externally. The runtime contains no autonomous merge action.

## Current status

**v0.9.0: hosted workflow service with request throttling, hash-chained audit records, provider network hardening, CI client contract fixes, durable-state enforcement, signed CI resume, and human-only final merge.**

The current live free Render service remains smoke-test durable until paid persistent storage is attached. Further production work should focus on persistent infrastructure, per-user authorization, sandboxed build execution, centralized immutable audit storage, and richer CI remediation context.
