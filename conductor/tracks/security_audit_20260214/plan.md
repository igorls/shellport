# Implementation Plan - Security Audit and Hardening

## Phase 1: Cryptographic & Authentication Audit [checkpoint: f3cf2ed]
- [x] **Task: Audit Key Derivation and Encryption**
    - [x] Write Tests: Verify PBKDF2 entropy and iteration count in `src/crypto.test.ts`.
    - [x] Write Tests: Verify AES-GCM IV randomness and uniqueness in `src/crypto.test.ts`.
    - [x] Implement: Harden `src/crypto.ts` based on audit findings.
- [x] **Task: Harden TOTP Verification**
    - [x] Write Tests: Create timing attack simulation tests for TOTP verification.
    - [x] Implement: Use constant-time comparison in `src/totp.ts`.
- [x] **Task: Conductor - User Manual Verification 'Phase 1: Cryptographic & Authentication Audit' (Protocol in workflow.md)**

## Phase 2: PTY & Input Sanitization [checkpoint: 7bf609b]
- [x] **Task: Audit PTY Sequence Handling**
    - [x] Write Tests: Simulate malicious terminal escape sequences in `src/server.test.ts`.
    - [x] Implement: Enhance PTY sanitization in `src/server.ts`.
- [x] **Task: WebSocket Bounds Checking**
    - [x] Write Tests: Fuzz WebSocket message handling with malformed and over-sized frames.
    - [x] Implement: Enforce strict bounds checking in `src/server.ts` and `src/types.ts`.
- [x] **Task: Conductor - User Manual Verification 'Phase 2: PTY & Input Sanitization' (Protocol in workflow.md)**

## Phase 3: Frontend Security & Final Integration
- [x] **Task: Secure Secret Handling in Frontend**
    - [x] Write Tests: Verify secret remains in `#` fragment and is not leaked to server via headers or parameters.
    - [x] Implement: Harden `src/frontend/app.js` and `index.html` (CSP headers).
- [x] **Task: Final Integration & Stress Testing**
    - [x] Write Tests: End-to-end security regression suite.
    - [x] Implement: Final hardening adjustments.
- [x] **Task: Conductor - User Manual Verification 'Phase 3: Frontend Security & Final Integration' (Protocol in workflow.md)**
