/**
 * Standalone ShellPort Test Server
 * 
 * Minimal Bun server that spawns a PTY shell and relays I/O over WebSocket.
 * Tests NanoTermV2 in isolation — zero ME dependencies.
 * 
 * Usage: bun run packages/shellport/test/shellport-test-server.ts
 * Then open http://localhost:7777 in your browser.
 */

import * as path from 'path';

const PORT = 7777;
const testDir = path.dirname(new URL(import.meta.url).pathname);
const nanoTermPath = path.join(testDir, '..', 'src', 'frontend', 'nanoterm.js');

// Track active PTY sessions per WebSocket
const sessions = new Map<number, ReturnType<typeof Bun.spawn>>();
let sessionCounter = 0;

const server = Bun.serve({
    port: PORT,
    fetch(req, server) {
        const url = new URL(req.url);

        // WebSocket upgrade
        if (url.pathname === '/ws') {
            const upgraded = server.upgrade(req, {
                data: { id: ++sessionCounter },
            });
            if (upgraded) return undefined;
            return new Response('WebSocket upgrade failed', { status: 500 });
        }

        // Serve NanoTermV2 vendor script
        if (url.pathname === '/vendor/nanoterm.js') {
            return new Response(Bun.file(nanoTermPath), {
                headers: { 'Content-Type': 'application/javascript' },
            });
        }

        // Serve test HTML
        if (url.pathname === '/' || url.pathname === '/index.html') {
            return new Response(Bun.file(path.join(testDir, 'shellport-test.html')), {
                headers: { 'Content-Type': 'text/html' },
            });
        }

        return new Response('Not Found', { status: 404 });
    },

    websocket: {
        open(ws) {
            const shellCmd = process.env.SHELL || '/bin/bash';
            console.log(`🐚 [Test] Client ${ws.data.id} connected — spawning PTY: ${shellCmd}`);

            const proc = Bun.spawn([shellCmd], {
                cwd: process.env.HOME || '/tmp',
                env: {
                    ...process.env,
                    TERM: 'xterm-256color',
                    COLORTERM: 'truecolor',
                },
                terminal: {
                    cols: 120,
                    rows: 40,
                    data: (_terminal: unknown, data: Uint8Array) => {
                        try {
                            if (ws.readyState === 1) {
                                ws.send(data);
                            }
                        } catch { /* client disconnected */ }
                    },
                },
            });

            sessions.set(ws.data.id, proc);
            console.log(`🐚 [Test] PTY spawned PID=${proc.pid}`);
        },

        message(ws, message) {
            const proc = sessions.get(ws.data.id);
            if (!proc) return;

            // Binary input → PTY terminal
            if (typeof message !== 'string') {
                try {
                    const terminal = (proc as any).terminal;
                    if (terminal) {
                        terminal.write(new TextDecoder().decode(message as ArrayBuffer));
                    }
                } catch { /* process exited */ }
                return;
            }

            // JSON control messages
            try {
                const msg = JSON.parse(message);
                if (msg.type === 'resize' && msg.cols && msg.rows) {
                    const terminal = (proc as any).terminal;
                    if (terminal) {
                        terminal.resize(msg.cols, msg.rows);
                        console.log(`🐚 [Test] Resized PTY to ${msg.cols}x${msg.rows}`);
                    }
                }
            } catch {
                // Not JSON — treat as text input
                const terminal = (proc as any).terminal;
                if (terminal) {
                    terminal.write(message);
                }
            }
        },

        close(ws) {
            const proc = sessions.get(ws.data.id);
            if (proc) {
                console.log(`🐚 [Test] Client ${ws.data.id} disconnected — killing PID=${proc.pid}`);
                try {
                    (proc as any).terminal?.close();
                    proc.kill();
                } catch { /* already dead */ }
                sessions.delete(ws.data.id);
            }
        },
    },
});

console.log(`\n🧪 ShellPort Standalone Test Server`);
console.log(`   Open http://localhost:${PORT} in your browser\n`);
