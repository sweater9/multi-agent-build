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
- `GET /ready` — state-directory/configuration readiness

Bearer-authenticated workflow endpoints:

- `POST /api/workflows` with `{ "goal": "..." }`
- `GET /api/workflows/:workflowRunId`
- `POST /api/workflows/:workflowRunId/resume`

GitHub webhook endpoint:

- `POST /webhooks/github` — independently authenticated with `X-Hub-Signature-256`

The API compares bearer secrets in constant time after hashing. Request bodies are bounded, API responses disable caching, and error responses do not expose internal stack traces.

## Repository automation

Repository automation is optional and configured only through environment variables. When enabled, the service creates a `GitHubRestClient`, routes all repository operations through `ToolGateway`, restricts writes to the configured feature branch, and preserves the human-only final merge boundary.

Required variables for repository automation:

- `GITHUB_TOKEN`
- `TARGET_REPOSITORY` (for example `owner/repo`)
- `TARGET_BRANCH` (defaults to `feature/agent-build`)
- `TARGET_BASE` (defaults to `main`)

Optional model-provider variables:

- `AGENT_PROVIDER_URL`
- `AGENT_PROVIDER_API_KEY`
- `AGENT_PROVIDER_TIMEOUT_MS`

Webhook resume requires `GITHUB_WEBHOOK_SECRET`.

## Implemented controls

- Explicit workflow state machine and bounded Builder -> QA/CI repair loop
- Runtime validation of agent handoffs
- Persistent/resumable `awaiting_ci` checkpoints
- Vendor-neutral model provider adapters
- Controlled repository branch, file, diff, PR, and CI-status operations
- No direct writes to `main` or `master` through repository handlers
- CI must reach terminal success before `ready_for_merge: true`
- Failed CI checks feed back into Builder for bounded repair
- Final merge remains explicit human approval
- Signed GitHub webhook verification using HMAC-SHA256
- Durable delivery-ID replay protection
- Repository + branch matching for event-driven resume
- Bearer authentication for workflow APIs
- Public liveness and readiness endpoints
- Bounded HTTP request bodies and no-store API responses
- Basic secret redaction for logs/errors
- GitHub Actions CI with syntax checks, tests, and dependency audit

## Render deployment

`render.yaml` provides a Frankfurt Node web-service blueprint using `npm run service` and `/health` as the service health check.

Secrets are intentionally not committed. Set at least `SERVICE_API_KEY` in Render. Configure `GITHUB_TOKEN`, `TARGET_REPOSITORY`, and `GITHUB_WEBHOOK_SECRET` only when repository automation and event-driven resume are required.

The included free-plan blueprint stores workflow state under `/tmp/multi-agent-runs`. **That filesystem is ephemeral.** It is suitable for deployment/smoke testing, but long-lived production runs require a persistent Render disk or an external durable state store before the service should be considered production-durable.

## Security model

The runtime follows least privilege and treats user, provider, retrieved, agent-generated, and webhook content as untrusted. Privileged actions are exposed only through narrowly scoped handlers and per-role tool allowlists. Target repositories and branches are explicitly allowlisted, base branches are separately allowlisted, and high/critical QA or CI findings prevent completion.

Production credentials and webhook secrets must be supplied externally. The runtime contains no autonomous merge action.

## Current status

**v0.7.0: authenticated hosted service layer with GitHub REST integration, health/readiness checks, signed event-driven CI resume, and Render deployment configuration.**

Further production hardening should move workflow state to durable managed storage, add per-user authorization/rate limits, immutable centralized audit storage, a managed secret store, stronger prompt-injection defenses, sandboxed build execution, and detailed CI log ingestion.
