/**
 * ShellPort - Types & Constants
 */

/** Frame types for the wire protocol */
export const FrameType = {
    /** Terminal data (stdin/stdout) */
    DATA: 0,
    /** Control messages (resize, etc.) */
    CONTROL: 1,
    /** Server nonce for session salt derivation */
    SERVER_NONCE: 2,
    /** Client nonce for session salt derivation */
    CLIENT_NONCE: 3,
    /** Approval request (server -> client) */
    APPROVAL_REQUEST: 4,
    /** Approval response (client -> server) */
    APPROVAL_RESPONSE: 5,
} as const;

export type FrameTypeValue = (typeof FrameType)[keyof typeof FrameType];

/** Decoded frame from the wire */
export interface DecodedFrame {
    type: FrameTypeValue;
    payload: Uint8Array;
}

/** Terminal resize dimensions */
export interface TerminalSize {
    cols: number;
    rows: number;
}

/** Control message sent through the CONTROL channel */
export interface ControlMessage {
    type: "resize";
    cols: number;
    rows: number;
}

/** Server configuration */
export interface ServerConfig {
    port: number;
    secret: string;
    tailscale: string;
    /** Require interactive approval for new connections */
    requireApproval: boolean;
    /** Allow localhost origin bypass (dev mode) */
    allowLocalhost: boolean;
}

/** Client configuration */
export interface ClientConfig {
    url: string;
    secret: string;
}

/** Per-connection WebSocket data */
export interface SessionData {
    sendQ: SeqQueue;
    recvQ: SeqQueue;
    proc: ReturnType<typeof import("bun").spawn> | null;
    /** Whether the client has proven knowledge of the encryption key */
    authenticated: boolean;
    /** Timer for auth timeout (cleared on successful auth) */
    authTimer?: ReturnType<typeof setTimeout>;
    /** Per-session nonce from server */
    serverNonce?: Uint8Array;
    /** Client IP address for approval prompts */
    clientIP?: string;
    /** Pending approval resolve function */
    approvalResolve?: (approved: boolean) => void;
    /** Timer for approval timeout */
    approvalTimer?: ReturnType<typeof setTimeout>;
}

/** Sequential async queue for ordered message handling */
export class SeqQueue {
    private p: Promise<void> = Promise.resolve();

    add(fn: () => Promise<void>): void {
        this.p = this.p.then(fn).catch(() => {
            // Error sanitized - avoid logging sensitive data
        });
    }
}
