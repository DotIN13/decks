#!/usr/bin/env node
// Lands a linked checkout's branch on rewrite, the only way to: REWRITE_AGENT=<you> node tools/gates/land.mjs,
// run in your own checkout. It takes the landing lock (refused while anyone holds it, a full run
// included), rebases on rewrite, runs the check of each folder your commits touch and the gates, then
// fast-forwards the main checkout's rewrite and lets the lock go. Nothing is forced; any refusal stops it.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { LOCK } from "./hold.mjs";

// Paths as they are written, in any script: git quotes non-ASCII names unless told not to.
const git = (args, cwd) => execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** The folders tools/check.mjs checks alone, the longest first so clients/sdk wins over clients. */
const FOLDERS = ["clients/sdk", "clients/cli", "clients/mcp", "clients/extension", "harness/page", "protocol", "server", "harness", "canvas", "engine", "pen", "ui", "tools"];

/** Who holds the lock, as a sentence; undefined when it is free. */
export function heldBy(lock = LOCK) {
	if (!existsSync(lock)) return undefined;
	const ownerFile = join(lock, "owner");
	const owner = existsSync(ownerFile) ? readFileSync(ownerFile, "utf8").trim() : "someone who named no owner";
	const since = new Date(statSync(lock).mtimeMs).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Los_Angeles" });
	return `${owner}, since ${since}`;
}

/** The folders to check for the files a branch changes against rewrite: each file's longest known folder. */
export function foldersOf(files) {
	const out = new Set();
	for (const file of files) {
		const folder = FOLDERS.find((f) => file.startsWith(`${f}/`));
		if (folder) out.add(folder);
	}
	return [...out].sort();
}

function main() {
	const agent = process.env.REWRITE_AGENT;
	if (!agent) return fail("Set REWRITE_AGENT=<your name>.");
	const here = git(["rev-parse", "--show-toplevel"]);
	const common = resolve(here, git(["rev-parse", "--git-common-dir"], here));
	const mainTree = dirname(common);
	if (resolve(here) === resolve(mainTree)) return fail("Run it in your own checkout: the main checkout lands nothing on itself.");
	const branch = git(["branch", "--show-current"], here);
	if (!branch || branch === "rewrite") return fail(`Your checkout is on ${branch || "no branch"}: land from your own branch (rewrite-<you>).`);
	if (git(["status", "--porcelain", "--untracked-files=no"], here)) return fail("Your checkout has uncommitted changes to tracked files: commit or set them aside first.");
	const held = heldBy();
	if (held) return fail(`The landing lock is held by ${held}. Nothing lands until it is free: wait, or ask the holder.`);
	try {
		mkdirSync(LOCK);
	} catch {
		return fail(`The landing lock was taken just now by ${heldBy() ?? "someone"}: try again when it is free.`);
	}
	writeFileSync(join(LOCK, "owner"), `${agent} landing ${branch}\n`);
	try {
		say(`rebasing ${branch} on rewrite`);
		if (spawnSync("git", ["rebase", "rewrite"], { cwd: here, stdio: "inherit" }).status !== 0) {
			spawnSync("git", ["rebase", "--abort"], { cwd: here, stdio: "ignore" });
			return fail("The rebase stopped on a conflict and was taken back: resolve it on your branch, then land again.");
		}
		const files = git(["diff", "--name-only", "rewrite...HEAD"], here).split("\n").filter(Boolean);
		if (!files.length) return fail(`${branch} has nothing rewrite does not have.`);
		for (const folder of foldersOf(files)) {
			say(`checking ${folder}`);
			if (spawnSync(process.execPath, [join(here, "tools/check.mjs"), folder], { cwd: here, stdio: "inherit" }).status !== 0) return fail(`node tools/check.mjs ${folder} fails: fix it, then land again.`);
		}
		say("running the gates");
		if (spawnSync(process.execPath, [join(here, "tools/gates/run.mjs")], { cwd: here, stdio: "inherit" }).status !== 0) return fail("The gates fail: fix them, then land again.");
		say(`fast-forwarding rewrite to ${branch} in ${mainTree}`);
		if (spawnSync("git", ["merge", "--ff-only", branch], { cwd: mainTree, stdio: "inherit" }).status !== 0) return fail("The fast-forward was refused (a file of yours edited in the main tree, or rewrite moved): stop and tell Mason; never force it.");
		say(`landed: rewrite is at ${git(["rev-parse", "--short", "HEAD"], mainTree)}. Send Mason a done line.`);
		return 0;
	} finally {
		rmSync(LOCK, { recursive: true, force: true });
	}
}

const say = (line) => console.log(`land: ${line}`);
function fail(why) {
	console.error(`land: ${why}`);
	return 1;
}

if (process.argv[1] === new URL(import.meta.url).pathname) process.exitCode = main();
