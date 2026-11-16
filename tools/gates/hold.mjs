#!/usr/bin/env node
// The landing hold: while a full run holds /tmp/decks-rewrite-land.lock, a commit in the main checkout
// is refused unless REWRITE_AGENT is the name in the lock's owner file. Other checkouts commit freely.
// The pre-commit hook runs it (install-hooks.mjs); take the hold with: mkdir LOCK && echo <name> > LOCK/owner.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const LOCK = "/tmp/decks-rewrite-land.lock";

/** Why a commit is refused under the hold, or undefined when it may go ahead. */
export function refusal({ lock = LOCK, agent, main }) {
	if (!main || !existsSync(lock)) return undefined;
	const ownerFile = join(lock, "owner");
	const owner = existsSync(ownerFile) ? readFileSync(ownerFile, "utf8").trim().split(/\s+/)[0] : "";
	if (owner && agent === owner) return undefined;
	const since = new Date(statSync(lock).mtimeMs).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Los_Angeles" });
	const who = owner ? `${owner} holds it` : `its owner file names no one (echo <name> > ${ownerFile})`;
	return `hold: a full run is going on the main checkout since ${since} (${lock}; ${who}). Nothing lands until it is over: commit in your own checkout, or wait for the word.`;
}

/** Whether this checkout is the main one, not a linked worktree: its git folder is the common one. */
export function isMain(cwd = process.cwd()) {
	const git = (arg) => resolve(cwd, execFileSync("git", ["rev-parse", arg], { cwd, encoding: "utf8" }).trim());
	return git("--git-dir") === git("--git-common-dir");
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
	const why = refusal({ agent: process.env.REWRITE_AGENT, main: isMain() });
	if (why) console.error(why);
	process.exitCode = why ? 1 : 0;
}
