/**
 * ShellPort - CLI Argument Parsing Tests
 *
 * Tests the parseArgs function for correct CLI argument extraction.
 */

import { describe, test, expect } from "bun:test";
import { parseArgs, VERSION } from "./index.js";

// ---------------------------------------------------------------------------
// Command detection
// ---------------------------------------------------------------------------
describe("parseArgs — commands", () => {
    test("recognizes 'server' command", () => {
        const parsed = parseArgs(["server"]);
        expect(parsed.command).toBe("server");
    });

    test("recognizes 'serve' alias", () => {
        const parsed = parseArgs(["serve"]);
        expect(parsed.command).toBe("serve");
    });

    test("recognizes 'client' command", () => {
        const parsed = parseArgs(["client", "ws://host/ws"]);
        expect(parsed.command).toBe("client");
    });

    test("recognizes 'connect' alias", () => {
        const parsed = parseArgs(["connect", "ws://host/ws"]);
        expect(parsed.command).toBe("connect");
    });

    test("defaults to 'help' when no args", () => {
        const parsed = parseArgs([]);
        expect(parsed.command).toBe("help");
    });
});

// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------
describe("parseArgs — options", () => {
    test("--port sets port", () => {
        const parsed = parseArgs(["server", "--port", "8080"]);
        expect(parsed.port).toBe(8080);
    });

    test("-p short flag sets port", () => {
        const parsed = parseArgs(["server", "-p", "9090"]);
        expect(parsed.port).toBe(9090);
    });

    test("--secret sets secret", () => {
        const parsed = parseArgs(["server", "--secret", "mykey"]);
        expect(parsed.secret).toBe("mykey");
    });

    test("-s short flag sets secret", () => {
        const parsed = parseArgs(["server", "-s", "mykey"]);
        expect(parsed.secret).toBe("mykey");
    });

    test("--tailscale sets tailscale mode", () => {
        const parsed = parseArgs(["server", "--tailscale", "funnel"]);
        expect(parsed.tailscale).toBe("funnel");
    });

    test("--no-secret sets noSecret flag", () => {
        const parsed = parseArgs(["server", "--no-secret"]);
        expect(parsed.noSecret).toBe(true);
    });

    test("positional arg sets url for client", () => {
        const parsed = parseArgs(["client", "ws://host:7681/ws"]);
        expect(parsed.url).toBe("ws://host:7681/ws");
    });

    test("all options combined", () => {
        const parsed = parseArgs([
            "server",
            "--port", "3000",
            "--secret", "s3cret",
            "--tailscale", "serve",
        ]);
        expect(parsed.command).toBe("server");
        expect(parsed.port).toBe(3000);
        expect(parsed.secret).toBe("s3cret");
        expect(parsed.tailscale).toBe("serve");
    });
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
describe("parseArgs — defaults", () => {
    test("default port is 7681", () => {
        const parsed = parseArgs(["server"]);
        expect(parsed.port).toBe(7681);
    });

    test("default secret is empty string", () => {
        const parsed = parseArgs(["server"]);
        expect(parsed.secret).toBe("");
    });

    test("default tailscale is empty string", () => {
        const parsed = parseArgs(["server"]);
        expect(parsed.tailscale).toBe("");
    });

    test("default url is empty string", () => {
        const parsed = parseArgs(["client"]);
        expect(parsed.url).toBe("");
    });

    test("default noSecret is false", () => {
        const parsed = parseArgs(["server"]);
        expect(parsed.noSecret).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// VERSION
// ---------------------------------------------------------------------------
describe("VERSION", () => {
    test("is a semver string", () => {
        expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
});
