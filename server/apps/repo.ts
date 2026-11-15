import { execFile } from "node:child_process";
import { Refused } from "../../protocol/index.ts";

// Every app is a git repository in its running copy. Rule 8.

export type Repo = { branch: string; head: string; dirty?: number; remote?: string };

const AUTHOR = ["-c", "user.name=Decks", "-c", "user.email=decks@localhost", "-c", "commit.gpgsign=false"];

/** Run git in a folder; answers its output, or throws with its last line. */
export function git(cwd: string, args: string[], ms = 60_000): Promise<string> {
	return new Promise((done, fail) => {
		execFile("git", [...AUTHOR, ...args], { cwd, timeout: ms, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (error, stdout, stderr) => {
			if (error) fail(new Error(String(stderr || error.message).trim().split("\n").pop()));
			else done(String(stdout));
		});
	});
}

const BUILT = [":(exclude)node_modules", ":(exclude)dist", ":(exclude).next"];

/** A repository in the folder, made when missing, with everything committed but what is built. */
export async function commitAll(cwd: string, message: string): Promise<void> {
	if (!(await ownRepo(cwd))) await git(cwd, ["init", "-q", "-b", "main"]);
	await git(cwd, ["add", "-A", "--", ".", ...BUILT]);
	const changed = (await git(cwd, ["diff", "--cached", "--name-only"])).trim();
	if (changed) await git(cwd, ["commit", "-q", "-m", message]);
}

/** Whether the folder is a repository's top, not a folder inside another one. */
async function ownRepo(cwd: string): Promise<boolean> {
	const top = await git(cwd, ["rev-parse", "--show-toplevel"]).then((out) => out.trim(), () => "");
	const here = await git(cwd, ["rev-parse", "--show-prefix"]).then((out) => out.trim(), () => "x");
	return top !== "" && here === "";
}

/** The repository's branch, last commit, changed files and origin; undefined when there is none. */
export async function repoOf(cwd: string): Promise<Repo | undefined> {
	if (!(await ownRepo(cwd))) return undefined;
	const head = await git(cwd, ["rev-parse", "--short", "HEAD"]).then((out) => out.trim(), () => undefined);
	if (!head) return undefined;
	const branch = (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
	const dirty = (await git(cwd, ["status", "--porcelain", "--", ".", ...BUILT])).split("\n").filter(Boolean).length;
	const remote = await git(cwd, ["remote", "get-url", "origin"]).then((out) => out.trim(), () => undefined);
	return { branch, head, ...(dirty ? { dirty } : {}), ...(remote ? { remote } : {}) };
}

/** Only https and git@host:path addresses, never a local path or another scheme. */
export function cloneable(url: string): boolean {
	return /^https:\/\/[^\s/]+\/\S+$/.test(url) || /^git@[\w.-]+:[\w./-]+$/.test(url);
}

/** Clone into a new folder beside the running copies; the folder must not exist. */
export async function clone(url: string, parent: string, folder: string): Promise<void> {
	if (!cloneable(url)) throw new Refused("invalid", `${url} is not an https:// or git@host:path address.`, "app.clone");
	await git(parent, ["clone", "-q", "--depth", "1", url, folder], 180_000).catch((error: Error) => {
		throw new Refused("unavailable", `git could not clone ${url}: ${error.message}`, "app.clone");
	});
}

/** A name for a cloned app, from its address. */
export function nameFromUrl(url: string): string {
	const last = url.replace(/\.git$/, "").split(/[/:]/).pop() ?? "app";
	return last.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "app";
}
