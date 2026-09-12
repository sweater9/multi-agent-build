# CodeSandbox execution provider

CodeSandbox can be used as the temporary execution provider for Multi-Agent Build while the hardened self-hosted Docker worker remains available as a fallback.

## Configuration

Set `CSB_API_KEY` (or `CODESANDBOX_API_KEY`) on the application service. Never commit the token.

Optional execution settings:

- `CODESANDBOX_SANDBOX_ID`: reuse a known sandbox/Devbox ID. If omitted, execution creates an isolated sandbox and hibernates it after the run.
- `CODESANDBOX_HIBERNATE_AFTER_RUN`: defaults to `true` for ephemeral sandboxes.
- `CODESANDBOX_MAX_OUTPUT_BYTES`: defaults to `256000`.
- `CODESANDBOX_WORKSPACE_ROOT`: defaults to `/tmp/multi-agent-build`.

When a CodeSandbox API key is configured, CodeSandbox becomes the primary execution provider. If no CodeSandbox key is configured, the existing `SANDBOX_RUNNER_URL` HTTPS worker path remains unchanged.

## Execution behavior

The existing execution policy still decides which commands are requested. The provider:

1. Acquires an existing configured sandbox or creates an ephemeral one.
2. Connects through the CodeSandbox SDK.
3. Stages only the generated project files under an isolated run directory.
4. Executes install/check/test/build steps sequentially.
5. Stops on the first failure and returns bounded diagnostics to the repair loop.
6. Hibernates newly-created sandboxes after the run.

The provider rejects absolute/traversal file paths and clamps captured command output.

### Security difference from the hardened Docker worker

CodeSandbox microVM isolation is useful for temporary remote execution, but this adapter does **not** currently enforce the per-step `network: off` policy used by the hardened Docker worker. Readiness therefore reports `sandbox_network_policy_enforced: false` when CodeSandbox is active. Do not treat CodeSandbox as security-equivalent to the self-hosted worker for hostile code or workloads requiring strict egress control.

## Existing `multi-agent` Devbox

The manually validated Devbox can be reused temporarily if its actual CodeSandbox sandbox ID is supplied through `CODESANDBOX_SANDBOX_ID`. Do not infer the API sandbox ID from a browser URL slug without checking it in CodeSandbox first.

## CodeSandbox Browser QA

Browser QA is intentionally opt-in and requires the reusable Devbox because that environment has already been validated with Playwright/Chromium.

Set:

- `CODESANDBOX_BROWSER_QA_ENABLED=true`
- `CODESANDBOX_SANDBOX_ID=<actual sandbox id>`
- `CODESANDBOX_PLAYWRIGHT_ROOT=/tmp/mab-test` if Playwright was installed in the validated helper directory used during validation.
- `CODESANDBOX_BROWSER_WORKSPACE_ROOT` optionally changes the staged browser-QA project root.

The Browser QA adapter stages the project, installs project dependencies with lifecycle scripts disabled, launches the project on localhost port 4173, waits for readiness, then runs Playwright from the configured helper installation. It checks page load, console errors, runtime errors, failed requests, missing image alt text, and unlabeled form controls. The project server is terminated after inspection.

Browser QA does not require a public preview URL because Playwright and the application run inside the same Devbox and communicate over localhost.

As with execution, CodeSandbox Browser QA does not enforce strict egress isolation; readiness reports `browser_qa_network_policy_enforced: false`. If `CODESANDBOX_BROWSER_QA_ENABLED` is absent or false, the existing `BROWSER_QA_RUNNER_URL` hardened worker remains the fallback.
