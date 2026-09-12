# Oracle Cloud Always Free sandbox worker

## Recommendation

For a zero-monthly-cost sandbox host, use an OCI Ampere A1 Always Free VM when capacity is available. The target is one VM with 2 OCPUs and up to 12 GB RAM. Keep the main multi-agent API on its existing host; run only the sandbox worker and its local npm proxy on this VM.

The sandbox worker must never receive model-provider API keys or GitHub credentials.

## Architecture

Main API (HTTPS) -> sandbox worker :4040 -> disposable Docker containers

Dependency installation containers attach only to `multi-agent-registry`, an internal Docker network. They fetch packages from `http://npm-registry:4873/`. Verdaccio is dual-homed: it joins the internal network and a separate egress network, so only the registry proxy—not generated code—can reach npmjs.org.

Test, check, build and browser execution containers run with `--network none`.

## OCI VM

1. Create an Always Free Ampere A1 VM in your OCI home region. Ubuntu is a straightforward host OS choice.
2. Allocate up to the Always Free allowance needed by this worker. Browser QA benefits materially from more than 1 GB RAM.
3. Expose SSH only from your administration IP. Do not expose Docker or the local npm proxy.
4. Expose the sandbox worker only through HTTPS, preferably behind Caddy or nginx, and restrict ingress to the main API host if practical.
5. Install Docker Engine and the Docker Compose plugin.
6. Clone this repository on the worker host.

OCI can reclaim Always Free compute it considers idle. Treat the worker as replaceable infrastructure and keep no irreplaceable state on it.

## Start the isolated npm proxy

From the repository root:

```sh
docker compose -f deploy/oracle-free/docker-compose.registry.yml up -d
```

Verify that the sandbox-facing network is internal:

```sh
docker network inspect --format '{{.Internal}}' multi-agent-registry
```

The result must be `true`.

The registry is intentionally not published to a host port. Generated containers reach it by Docker DNS at `npm-registry:4873` while attached to `multi-agent-registry`.

## Configure the worker

Copy `deploy/oracle-free/sandbox-worker.env.example` to a protected environment file and replace the token with a cryptographically random value of at least 24 characters.

Required values:

```text
SANDBOX_REGISTRY_NETWORK=multi-agent-registry
SANDBOX_NPM_REGISTRY_URL=http://npm-registry:4873/
SANDBOX_READ_ONLY_ROOT=true
```

For production-like hardening, resolve immutable SHA-256 digests for the Node and Playwright images, use the digest forms in `SANDBOX_NODE_IMAGE` and `SANDBOX_BROWSER_IMAGE`, then set:

```text
SANDBOX_REQUIRE_PINNED_IMAGES=true
```

The worker startup preflight checks Docker/Podman availability, rejects default networks, confirms `multi-agent-registry` is actually internal, validates the npm registry URL, and enforces digest pinning when requested.

## HTTPS boundary

`HttpSandboxExecutor` and `HttpBrowserQaExecutor` require an HTTPS worker endpoint. Terminate TLS in a reverse proxy and forward only to localhost port 4040. Do not make port 4040 publicly reachable directly.

Configure the main API with:

```text
SANDBOX_RUNNER_URL=https://sandbox.example.com
SANDBOX_RUNNER_TOKEN=<same worker token>
BROWSER_QA_RUNNER_URL=https://sandbox.example.com
BROWSER_QA_RUNNER_TOKEN=<same worker token>
```

Main-service readiness actively probes `/health`; a configured but unreachable worker causes readiness to fail.

## Security properties

- Generated execution does not share a host process with the main API.
- Containers drop all Linux capabilities and use `no-new-privileges`.
- Root filesystem is read-only by default.
- Containers run as a non-root UID/GID by default.
- PID, CPU, memory, file-descriptor, tmpfs and shared-memory limits are applied.
- Test/build/browser execution has no network.
- Dependency installation can reach only the internal Docker network and is forced to use the local npm registry URL.
- Verdaccio alone has outbound registry access and caches npm packages.
- Package lifecycle scripts remain disabled during `npm install`.
- Repair attempts remain bounded by the application-level repair budgets.

## Free-tier caveats

OCI Always Free capacity can be temporarily unavailable, especially for Ampere A1 shapes, and idle instances may be reclaimed. This makes it suitable for a hobby/pre-production autonomous builder, but not a contractual production SLA.

If A1 capacity is unavailable, do not fall back to a 1 GB micro VM for browser QA; it is too constrained for the intended execution path. A paid VM or another proper container-capable host is the safer fallback.
