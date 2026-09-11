# Isolated sandbox worker

The builder API must never execute generated project code in the same process or host context that holds model-provider credentials. The sandbox worker is a separate service boundary intended for a dedicated host with Docker or Podman installed.

## Security model

- Separate bearer token (`SANDBOX_WORKER_TOKEN`) with a minimum length of 24 characters.
- Generated files are written only to a temporary workspace and deleted after each run.
- Containers run with all Linux capabilities dropped, `no-new-privileges`, a PID limit, CPU limit, memory limit, and a bounded tmpfs.
- Dependency installation uses `npm install --ignore-scripts` to prevent package lifecycle scripts from executing.
- Test/check/build steps run with container networking disabled.
- Output and execution time are bounded.
- The worker does not receive model-provider API keys or GitHub credentials.
- Mobile execution remains disabled in the builder until the web pipeline is proven.

## Local operation

Set `SANDBOX_WORKER_TOKEN` and run `npm run sandbox` on a dedicated machine with Docker or Podman available. The builder service should point `SANDBOX_RUNNER_URL` to the worker's HTTPS endpoint and use the same secret through `SANDBOX_RUNNER_TOKEN`.

Do not expose the worker directly to the public internet without TLS, authentication, firewall restrictions, and an isolated host. Do not mount the Docker socket into the primary builder API service.

## Deployment gate

No production sandbox infrastructure is provisioned automatically by this repository. Provisioning a new host or paid service remains an explicit approval-gated action.
