import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cleanRemote } from "../docs/git.ts";
import { APP_NAME } from "./service.ts";

/**
 * Every app is a git repository of its own, so it can be shared: pushed to a remote by whoever made
 * it, and taken in by someone else with `decks apps clone <url>`.
 *
 * `decks.apps.create` makes the repository with the starter's files as its first commit, and
 * `decks.apps.repo` makes one for an app written by hand. Git runs as a program with its arguments
 * (never through a shell), is never asked to prompt, and is stopped if it takes too long. A clone
 * takes an https address or an scp-style `git@host:path` and nothing else: a local path, `file://`
 * or `ext::` would let an address read this Mac's files or run a command.
 */

/** What an app's repository leaves out: what a build or an install makes, secrets and clutter. */
export const GITIGNORE = ["node_modules/", "dist/", ".next/", "build/", ".env", ".env.*", "*.log", ".DS_Store", ""].join("\n");

const TIMEOUT_MS = 20_000;
const CLONE_TIMEOUT_MS = 120_000;
/** The name a commit is made under when this Mac's git has none. */
const FALLBACK = { name: "Decks", email: "decks@localhost" };

export interface RepoState {
	branch: string;
	/** The last commit, short. */
	head: string;
	/** How many files differ from the last commit, as `git status --porcelain` lists them. */
	dirty?: number;
	/** Where `origin` points, with any user or token taken out. */
	remote?: string;
}

interface Run {
	code: number;
	out: string;
	err: string;
}

function git(cwd: string, args: string[], timeout = TIMEOUT_MS): Promise<Run> {
	return new Promise((resolve) => {
		execFile(
			"git",
			args,
			{
				cwd,
				timeout,
				killSignal: "SIGKILL",
				maxBuffer: 8 * 1024 * 1024,
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes", LC_ALL: "C" },
			},
			(error, stdout, stderr) => {
				// A number is git's exit code; a word (ENOENT) means git could not be started at all.
				const exit = (error as { code?: unknown } | null)?.code;
				const code = !error ? 0 : typeof exit === "number" ? exit : -1;
				const killed = Boolean(error && (error as { killed?: boolean }).killed);
				resolve({ code, out: String(stdout ?? ""), err: killed ? `git took longer than ${timeout / 1000} s and was stopped.` : String(stderr ?? "") || (error?.message ?? "") });
			},
		);
	});
}

/** Run git and answer with what it printed, or throw with what it said went wrong. */
async function must(cwd: string, args: string[], timeout?: number): Promise<string> {
	const run = await git(cwd, args, timeout);
	if (run.code !== 0) throw new Error(`git ${args.find((arg) => !arg.startsWith("-") && !arg.includes("=")) ?? ""} failed: ${(run.err || run.out).trim().split("\n").slice(-3).join(" ")}`);
	return run.out.trim();
}

/** Whether the folder is a repository's top, not merely inside one (a deck may be a repository too). */
export function isRepo(folder: string): boolean {
	return existsSync(join(folder, ".git"));
}

/** `-c` settings for a commit: the person's own name where git has one, Decks' where it has not. */
async function identity(folder: string): Promise<string[]> {
	const read = async (key: string) => (await git(folder, ["config", key])).out.trim();
	const args: string[] = [];
	if (!(await read("user.email"))) args.push("-c", `user.email=${FALLBACK.email}`);
	if (!(await read("user.name"))) args.push("-c", `user.name=${FALLBACK.name}`);
	return args;
}

/**
 * Make the folder a repository on `main`, with a `.gitignore` if it has none, and commit all of it.
 * Throws if git is missing or any step fails; the folder's files are left as they were.
 */
export async function initRepo(folder: string, message: string): Promise<RepoState> {
	if (!isRepo(folder)) await must(folder, ["init", "-b", "main"]);
	if (!existsSync(join(folder, ".gitignore"))) writeFileSync(join(folder, ".gitignore"), GITIGNORE);
	await must(folder, ["add", "-A"]);
	// Hooks and signing are the person's for their own commits; this one is made for them, unattended.
	await must(folder, [...(await identity(folder)), "-c", "commit.gpgsign=false", "commit", "--no-verify", "--allow-empty", "-q", "-m", message]);
	return repoState(folder);
}

/** The branch, last commit, changed files and remote of a repository's folder. */
export async function repoState(folder: string): Promise<RepoState> {
	const branch = (await git(folder, ["symbolic-ref", "--short", "-q", "HEAD"])).out.trim() || "HEAD";
	const head = (await git(folder, ["rev-parse", "--short", "HEAD"])).out.trim();
	const status = await git(folder, ["status", "--porcelain"]);
	const dirty = status.code === 0 ? status.out.split("\n").filter((line) => line.trim()).length : undefined;
	const origin = (await git(folder, ["config", "--get", "remote.origin.url"])).out.trim();
	return { branch, head, ...(dirty === undefined ? {} : { dirty }), ...(origin ? { remote: cleanRemote(origin) } : {}) };
}

/**
 * The address, if a clone may be made from it: `https://host/path`, or `user@host:path` as git's
 * scp-style ssh address. Anything else throws — a local path or `file://` would read this Mac's
 * files, `ext::` runs a command, and a leading dash would be read by git as an option.
 */
export function checkCloneUrl(url: string): string {
	const text = String(url ?? "").trim();
	if (!text) throw new Error("Give the address of a git repository, as https://github.com/someone/app.git or git@github.com:someone/app.git.");
	if (text.startsWith("-") || /[\s\0-\x1f\x7f]/.test(text)) throw new Error(`${JSON.stringify(text)} is not a git address.`);
	if (/^https:\/\/(?:[^@/\s]+@)?[a-z0-9][a-z0-9.-]*(?::\d+)?\/[^\s]+$/i.test(text)) return text;
	if (/^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9.-]*:(?!-)[^\s:]+$/i.test(text)) return text;
	throw new Error(`Only an https:// address or git@host:path can be cloned, not ${JSON.stringify(text)}.`);
}

/** An app name from a repository's address: its last part without `.git`, as an app name is written. */
export function nameFromUrl(url: string): string | undefined {
	const last = url.replace(/[/\\]+$/, "").split(/[/:\\]/).pop() ?? "";
	const name = last
		.replace(/\.git$/i, "")
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^[^a-z0-9]+/, "")
		.slice(0, 48)
		.replace(/-+$/, "");
	return APP_NAME.test(name) ? name : undefined;
}

/**
 * Clone into a folder that does not exist yet, and answer with the repository's state. On any
 * failure the half-made folder is removed and this throws. `allowLocal` is for tests only, which
 * clone a bare repository on disk; nothing a person or an agent sends reaches it.
 */
export async function cloneRepo(url: string, folder: string, options: { allowLocal?: boolean } = {}): Promise<RepoState> {
	const address = options.allowLocal ? String(url) : checkCloneUrl(url);
	if (existsSync(folder)) throw new Error(`${folder} already exists.`);
	const guard = ["-c", "protocol.ext.allow=never", ...(options.allowLocal ? [] : ["-c", "protocol.file.allow=never"])];
	mkdirSync(dirname(folder), { recursive: true });
	try {
		await must(dirname(folder), [...guard, "clone", "-q", "--", address, folder], CLONE_TIMEOUT_MS);
		return await repoState(folder);
	} catch (error) {
		rmSync(folder, { recursive: true, force: true });
		throw error;
	}
}
