import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, delimiter, dirname, join } from "node:path";

/**
 * Finding the Claude CLI (DESIGN §6.2).
 *
 * The SDK is a thin client for a native binary it installs as an optional
 * dependency, per platform, and it does not look on `PATH`: without that package it
 * fails with "Native CLI binary for … not found" rather than falling back. So the
 * looking is ours to do, and doing it means a Decks install can skip the binary
 * entirely when the machine already has Claude Code on it — which most machines
 * running this will.
 *
 * Order: an explicit setting, then `PATH`, then the SDK's own bundled copy. The
 * bundle is counted as *found* because the SDK itself launches it when nothing is
 * on PATH — refusing to start over it would be refusing a working runtime.
 */

/** Override for a Claude Code that lives somewhere unusual. */
export const CLAUDE_PATH_ENV = "DECKS_CLAUDE_PATH";

/** A test escape hatch: an install that forbids the SDK's own binary. */
export const CLAUDE_BUNDLED_ENV = "DECKS_CLAUDE_BUNDLED";

export function claudeExecutable(override?: string): string | undefined {
	for (const candidate of [override, process.env[CLAUDE_PATH_ENV]]) {
		if (candidate && existsSync(candidate)) return candidate;
	}

	// `claude` with no extension is the launcher on POSIX; on Windows the real binary is
	// `claude.exe`, with `.cmd` for npm-installed copies.
	const names = process.platform === "win32" ? ["claude.exe", "claude.cmd", "claude"] : ["claude"];
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		for (const name of names) {
			const candidate = join(dir, name);
			if (existsSync(candidate)) return candidate;
		}
	}
	return undefined;
}

/**
 * The CLI the SDK ships with itself, if this install has one.
 *
 * The SDK declares `@anthropic-ai/claude-agent-sdk-<platform>-<arch>[-musl]` as an
 * optional dependency, so the binary lives in the same `node_modules/@anthropic-ai`
 * scope as the SDK it was installed for. Scanning that scope keeps the check honest
 * across glibc and musl platforms without naming a fixed package.
 */
export function claudeBundledExecutable(): string | undefined {
	if (process.env[CLAUDE_BUNDLED_ENV] === "0") return undefined;
	try {
		const require = createRequire(import.meta.url);
		const sdkEntry = require.resolve("@anthropic-ai/claude-agent-sdk");
		// The entry lives inside the package (root or a dist dir); walking up to the
		// package directory lands on the `@anthropic-ai` scope the platform packages
		// sit in next to it.
		let sdkRoot = dirname(sdkEntry);
		while (basename(sdkRoot) !== "claude-agent-sdk" && sdkRoot !== dirname(sdkRoot)) sdkRoot = dirname(sdkRoot);
		const scope = dirname(sdkRoot);
		const run = process.platform === "win32" ? "claude.exe" : "claude";
		for (const entry of readdirSync(scope, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			if (!entry.name.startsWith(`claude-agent-sdk-${process.platform}-`)) continue;
			const candidate = join(scope, entry.name, run);
			if (existsSync(candidate)) return candidate;
		}
	} catch {
		// No SDK package: nothing either of us could launch.
	}
	return undefined;
}

/**
 * Whether a Claude agent could start, and what is missing if not.
 *
 * Used to fail with a sentence a person can act on, in the agent's own column, rather
 * than with the SDK's message about a platform package nobody asked for.
 */
export function claudeAvailability(override?: string): { available: boolean; reason?: string } {
	if (claudeExecutable(override) || claudeBundledExecutable()) return { available: true };
	return {
		available: false,
		reason: `No Claude Code executable found. Install Claude Code, set ${CLAUDE_PATH_ENV} to where it lives, or install the SDK's platform package (npm install @anthropic-ai/claude-agent-sdk).`,
	};
}