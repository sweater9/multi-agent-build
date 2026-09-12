# Isolated sandbox worker

The builder API must never execute generated project code in the same process or host context that holds model-provider credentials. The sandbox worker is a separate service boundary intended for a dedicated host with Docker or Podman installed.

## Security model

- Separate bearer token (`SANDBOX_WORKER_TOKEN`) with a minimum length of 24 characters.
- Generated files are written only to a temporary workspace and deleted after each run.
- Containers run with all Linux capabilities dropped, `no-new-privileges`, PID/CPU/memory/file-descriptor limits, a read-only root filesystem, a bounded tmpfs, and a non-root numeric user by default.
- Dependency installation uses `npm install --ignore-scripts` to prevent package lifecycle scripts from executing.
- Dependency installation is permitted only through a separately configured isolated Docker/Podman network (`SANDBOX_REGISTRY_NETWORK`). The worker no longer falls back to the unrestricted default bridge network.
- Test/check/build and browser execution run with container networking disabled.
- Browser QA uses a bounded shared-memory allocation and now performs basic image-alt and form-label accessibility checks in addition to page/console checks.
- Output and execution time are bounded.
- The worker does not receive model-provider API keys or GitHub credentials.
- The main service actively probes the worker `/health` endpoint when sandbox/browser execution is configured; an unreachable configured worker makes readiness fail.
- Mobile execution remains disabled in the builder until the web pipeline is proven.

## Required configuration

Set at minimum:

- `SANDBOX_WORKER_TOKEN` — 24+ character secret.
- `SANDBOX_REGISTRY_NETWORK` — a dedicated container network whose egress is constrained to the package registry/proxy you operate.

Optional hardening:

- `SANDBOX_CONTAINER_USER` — explicit numeric `uid:gid`; otherwise the worker process UID/GID is used when available.
- `SANDBOX_READ_ONLY_ROOT` — defaults to `true`.
- `SANDBOX_REQUIRE_PINNED_IMAGES=true` — refuse startup unless both `SANDBOX_NODE_IMAGE` and `SANDBOX_BROWSER_IMAGE` use immutable `@sha256:<digest>` references.
- `SANDBOX_NODE_IMAGE` and `SANDBOX_BROWSER_IMAGE` — use digest-pinned images in production.

The isolated registry network must be created outside this application. It should route package downloads through a registry mirror or egress proxy with an allowlist; simply creating another unrestricted bridge network does not satisfy the intended production control.

## Local operation

Set the required variables and run `npm run sandbox` on a dedicated machine with Docker or Podman available. The builder service should point `SANDBOX_RUNNER_URL` to the worker's HTTPS endpoint and use the same secret through `SANDBOX_RUNNER_TOKEN`.

Do not expose the worker directly to the public internet without TLS, authentication, firewall restrictions, and an isolated host. Do not mount the Docker socket into the primary builder API service.

## Deployment gate

No production sandbox infrastructure is provisioned automatically by this repository. Provisioning a new host, registry proxy/network, or paid service remains an explicit approval-gated action.
