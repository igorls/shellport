# Product Guidelines - ShellPort

## Security & Cryptography
- **Strict Cryptographic Auditing:** Every change to `src/crypto.ts`, `src/totp.ts`, or any logic touching encryption keys/nonces requires a rigorous security review. We prioritize resistance to side-channel attacks and ensure high-entropy generation for all secrets.
- **Minimal Attack Surface:** We strictly maintain zero runtime dependencies. The codebase should remain small enough to be audited by a single person in one sitting.
- **Defensive PTY Handling:** All data coming from the shell process must be treated as untrusted. Escape sequences and control characters must be handled defensively to prevent terminal-based attacks on the client.

## Stability & Development
- **Test-Driven Stability:** No bug fix or feature is considered complete without accompanying automated tests. We prioritize regression tests that simulate adverse conditions like high-latency networks, malformed binary frames, and complex terminal sequences (e.g., nested tmux/vim sessions).
- **Single-Binary Integrity:** All frontend assets (HTML, CSS, JS) must be inlined into the final binary. The build process must ensure that the "zero dependency" promise is verified at the binary level.
- **Cross-Platform Consistency:** Changes must be verified on Linux, macOS, and Windows to ensure PTY behavior and cryptographic primitives remain consistent across environments.

## User Experience (UX)
- **Transparent Security UX:** The user interface must proactively communicate the security state. This includes clear indicators for E2E encryption status, active 2FA, and explicit confirmation prompts for sensitive operations (like remote connection approvals).
- **Frictionless Defaults:** We favor "secure by default" configurations. Features like Tailscale integration and auto-generated session secrets should work out-of-the-box to provide a seamless yet protected experience.
- **High-Performance Rendering:** NanoTermV2 must prioritize low-latency rendering. The canvas-based approach should be optimized to ensure that typing and scrolling feel native, even over the web.
