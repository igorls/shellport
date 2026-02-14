# Implementation Plan - Security Audit and Hardening

## Phase 1: Cryptographic & Authentication Audit
- [ ] **Task: Audit Key Derivation and Encryption**
    - [ ] Write Tests: Verify PBKDF2 entropy and iteration count in `src/crypto.test.ts`.
    - [ ] Write Tests: Verify AES-GCM IV randomness and uniqueness in `src/crypto.test.ts`.
    - [ ] Implement: Harden `src/crypto.ts` based on audit findings.
- [ ] **Task: Harden TOTP Verification**
    - [ ] Write Tests: Create timing attack simulation tests for TOTP verification.
    - [ ] Implement: Use constant-time comparison in `src/totp.ts`.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1: Cryptographic & Authentication Audit' (Protocol in workflow.md)**

## Phase 2: PTY & Input Sanitization
- [ ] **Task: Audit PTY Sequence Handling**
    - [ ] Write Tests: Simulate malicious terminal escape sequences in `src/server.test.ts`.
    - [ ] Implement: Enhance PTY sanitization in `src/server.ts`.
- [ ] **Task: WebSocket Bounds Checking**
    - [ ] Write Tests: Fuzz WebSocket message handling with malformed and over-sized frames.
    - [ ] Implement: Enforce strict bounds checking in `src/server.ts` and `src/types.ts`.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2: PTY & Input Sanitization' (Protocol in workflow.md)**

## Phase 3: Frontend Security & Final Integration
- [ ] **Task: Secure Secret Handling in Frontend**
    - [ ] Write Tests: Verify secret remains in `#` fragment and is not leaked to server via headers or parameters.
    - [ ] Implement: Harden `src/frontend/app.js` and `index.html` (CSP headers).
- [ ] **Task: Final Integration & Stress Testing**
    - [ ] Write Tests: End-to-end security regression suite.
    - [ ] Implement: Final hardening adjustments.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3: Frontend Security & Final Integration' (Protocol in workflow.md)**
