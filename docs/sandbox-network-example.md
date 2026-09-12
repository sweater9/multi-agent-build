# Registry-only dependency egress

`SANDBOX_REGISTRY_NETWORK` must name a Docker/Podman network whose outbound access is restricted to the package registry or registry proxy you operate. The application intentionally does not create this network because secure egress policy is host/infrastructure specific.

Recommended production pattern:

1. Run a registry mirror or HTTP(S) egress proxy on a controlled network.
2. Allow that proxy to reach only approved package-registry domains.
3. Attach sandbox install containers to the isolated network through `SANDBOX_REGISTRY_NETWORK`.
4. Keep test, build, runtime, and browser-QA execution on `--network none`.
5. Enable `SANDBOX_REQUIRE_PINNED_IMAGES=true` after setting digest-pinned node and browser images.

Do not set `SANDBOX_REGISTRY_NETWORK` to the default unrestricted `bridge` network in production.
