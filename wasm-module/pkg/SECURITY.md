# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 2.x | Yes |
| 1.x | Security fixes only |
| < 1.0 | No |

## Reporting a vulnerability

Please don't open a public issue. Report it privately through [GitHub security advisories](https://github.com/asemqaffaf/rust-fetch/security/advisories/new) instead.

Include the affected version, a description of the issue and, if possible, a minimal reproduction. You'll get an acknowledgement within 7 days. Fixes are released as patch versions for every supported major version, and an advisory is published once a fix is available.

## Package contents and expected capabilities

The npm package has no runtime npm dependencies or install scripts. It includes the compiled WebAssembly module and JavaScript bindings; installation does not compile Rust or download a native binary. Releases are built and tested in GitHub Actions, published with npm provenance, and checked after publication for a valid registry signature and provenance attestation.

Network access is part of the client's purpose: HTTP requests, redirects, Server-Sent Events, and WebSocket connections use destinations supplied by the application. In browsers, `init()` also fetches the bundled `.wasm` asset unless the application supplies bytes or a compiled module. The package does not send usage telemetry or check for updates.

The Node.js entry reads its bundled `.wasm` file on import. It can load an optional local native addon, including a path configured with `RUST_FETCH_NATIVE`, and that addon can read a certificate file configured with `NODE_EXTRA_CA_CERTS`. The transport also reads proxy and TLS environment settings. Importing the Node.js entry does not make an outbound network request.

Scanners may flag these capabilities for review. A network-access alert is expected for this HTTP client; it does not by itself indicate an undisclosed destination or a vulnerability. Review the published files and the [security guide](https://asemqaffaf.github.io/rust-fetch/security) for URL restrictions, credential handling, private-network blocking, and resource limits. The safety limits that are opt-in must be configured for the application's trust boundaries.
