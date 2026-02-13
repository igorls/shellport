/**
 * ShellPort - Frontend HTML Builder
 *
 * Reads the frontend template and injects styles, crypto engine,
 * NanoTermV2 emulator, and app logic as inline content.
 * This produces a single self-contained HTML response.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readFrontendFile(filename: string): string {
    return readFileSync(resolve(__dirname, filename), "utf-8");
}

/**
 * Build the complete HTML client by injecting all frontend assets
 * into the HTML template.
 */
export function buildHTML(cryptoJS: string): string {
    const template = readFrontendFile("index.html");
    const styles = readFrontendFile("styles.css");
    const nanoterm = readFrontendFile("nanoterm.js");
    const app = readFrontendFile("app.js");

    return template
        .replace("{{STYLES}}", styles)
        .replace("{{CRYPTO_JS}}", cryptoJS)
        .replace("{{NANOTERM_JS}}", nanoterm)
        .replace("{{APP_JS}}", app);
}
