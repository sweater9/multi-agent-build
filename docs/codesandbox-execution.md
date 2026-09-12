# CodeSandbox execution provider

CodeSandbox can be used as the temporary execution provider for Multi-Agent Build while the hardened self-hosted Docker worker remains available as a fallback.

## Configuration

Set `CSB_API_KEY` (or `CODESANDBOX_API_KEY`) on the application service. Never commit the token.

Optional settings:

- `CODESANDBOX_SANDBOX_ID`: reuse a known sandbox/Devbox ID. If omitted, execution creates an isolated sandbox and hibernates it after the run.
- `CODESANDBOX_HIBERNATE_AFTER_RUN`: defaults to `true` for ephemeral sandboxes.
- `CODESANDBOX_MAX_OUTPUT_BYTES`: defaults to `256000`.
- `CODESANDBOX_WORKSPACE_ROOT`: defaults to `/tmp/multi-agent-build`.

When a CodeSandbox API key is configured, CodeSandbox becomes the primary execution provider. If no CodeSandbox key is configured, the existing `SANDBOX_RUNNER_URL` HTTPS worker path remains unchanged.

## Execution behavior

The existing execution policy still decides what is allowed to run. The provider only executes the already-bounded plan:

1. Acquire an existing configured sandbox or create an ephemeral one.
2. Connect through the CodeSandbox SDK.
3. Stage only the generated project files under an isolated run directory.
4. Execute install/check/test/build steps sequentially.
5. Stop on the first failure and return bounded diagnostics to the repair loop.
6. Hibernate newly-created sandboxes after the run.

The provider rejects absolute/traversal file paths and clamps captured command output.

## Existing `multi-agent` Devbox

The manually validated Devbox can be reused temporarily if its actual CodeSandbox sandbox ID is supplied through `CODESANDBOX_SANDBOX_ID`. Do not infer the API sandbox ID from a browser URL slug without checking it in CodeSandbox first.

## Browser QA

This release does not replace the existing browser-QA transport. `BROWSER_QA_RUNNER_URL` continues to use the hardened HTTP browser worker. CodeSandbox browser QA is a separate follow-up so that Playwright process lifecycle, preview ports and screenshot handling can be tested independently instead of weakening the existing browser gate.
