# Track Specification: Security Audit and Hardening

## Objective
Conduct a comprehensive security audit of ShellPort's core components and implement hardening measures to ensure the project is ready for a secure public open-source release.

## Scope
- **`src/crypto.ts`:** Key derivation (PBKDF2), encryption (AES-256-GCM), and nonce/salt management.
- **`src/totp.ts`:** RFC 6238 implementation, timing attack resistance, and secret storage.
- **`src/server.ts`:** PTY process spawning, escape sequence handling, and WebSocket bounds checking.
- **`src/frontend/app.js`:** Secure handling of the URL fragment secret and DOM-based vulnerability prevention.

## Requirements
1. **Cryptographic Integrity:**
   - Verify PBKDF2 iterations are sufficient (100k+) and salt is globally unique per session.
   - Ensure AES-GCM IVs are cryptographically random and never reused for the same key.
   - Validate that the E2E secret never leaves the browser in plaintext or via HTTP requests.
2. **Authentication Hardening:**
   - Implement constant-time comparison for TOTP code verification to prevent timing attacks.
   - Verify rate limiting on authentication attempts.
3. **PTY & Transport Security:**
   - Audit PTY sequence parsing for potential "terminal escape sequence" vulnerabilities.
   - Enforce strict bounds checking on all incoming WebSocket messages (binary and control).
4. **Platform Security:**
   - Review and enforce secure default settings for Tailscale integration (HTTPS/Funnel).

## Acceptance Criteria
- Successful completion of all audit tasks in the implementation plan.
- All identified security vulnerabilities are mitigated.
- 100% test coverage for all cryptographic and authentication-related functions.
- Verified stability of hardened components under stress testing.
