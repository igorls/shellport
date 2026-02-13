#!/usr/bin/env bun
/**
 * ShellPort - Cross-platform binary builder
 *
 * Builds precompiled executables for all supported platforms using
 * `bun build --compile`. Run with `bun run build:binaries`.
 */

import { $ } from "bun";
import { mkdirSync, existsSync } from "fs";

const ENTRY = "./src/index.ts";
const DIST = "./dist";

const targets = [
    { target: "bun-linux-x64", outfile: "shellport-linux-x64" },
    { target: "bun-linux-arm64", outfile: "shellport-linux-arm64" },
    { target: "bun-darwin-x64", outfile: "shellport-darwin-x64" },
    { target: "bun-darwin-arm64", outfile: "shellport-darwin-arm64" },
    { target: "bun-windows-x64", outfile: "shellport-windows-x64" },
];

async function main() {
    if (!existsSync(DIST)) {
        mkdirSync(DIST, { recursive: true });
    }

    console.log(`[build] Building ${targets.length} platform binaries...\n`);

    for (const { target, outfile } of targets) {
        const out = `${DIST}/${outfile}`;
        console.log(`  → ${target} → ${out}`);

        try {
            await $`bun build ${ENTRY} --compile --target=${target} --minify --bytecode --outfile ${out}`;
            console.log(`    ✅ Done`);
        } catch (error) {
            console.error(`    ❌ Failed: ${error}`);
        }
    }

    console.log(`\n[build] All binaries written to ${DIST}/`);
}

main();
