import { spawn } from "node:child_process";
import { dirname, relative } from "node:path";
import type { GitResult, GitStatus } from "@decks/docs";

/**
 * Pulling and pushing the git repository a document sits in, so a paper can be kept in step with
 * Overleaf (whose projects are git repositories) or any other remote.
 *
 * **A pull commits first.** Whatever has been typed or written here is committed as "Edited in
 * Decks", then the remote's commits are merged. That is the only way git merges two people's
 * edits rather than refusing, and it leaves nothing typed at risk: if the merge stops on lines
 * both sides changed, it is called off, and the repository is as it was after the commit.
 * **A push pulls first**, since a remote ahead of us refuses one, then sends our commits.
 *
 * Git is never asked to prompt: a remote that wants a password it was not given fails at once,
 * with a sentence saying how to give it one. Hooks and config are the repository's own.
 */

const TIMEOUT_MS = 90_000;
const MESSAGE = "Edited in Decks";

interface Run {
	code: number;
	out: string;
}

function git(cwd: string, args: string[]): Promise<Run> {
	return new Promise((resolve) => {
		const child = spawn("git", args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes", LC_ALL: "C" },
		});
		let out = "";
		child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
		child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
		const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ code: -1, out: error.message });
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			resolve({ code: signal ? -1 : (code ?? -1), out: signal ? `git took longer than ${TIMEOUT_MS / 1000} s and was stopped.` : out });
		});
	});
}

/** The repository's top folder, or undefined for a file in none. */
async function rootOf(file: string): Promise<string | undefined> {
	const run = await git(dirname(file), ["rev-parse", "--show-toplevel"]);
	return run.code === 0 ? run.out.trim() : undefined;
}

/** An address with any user, token or password taken out, safe to show. */
export function cleanRemote(url: string): string {
	return url.replace(/^(\w+:\/\/)[^@/]*@/, "$1");
}

/** What to call a remote: Overleaf for an Overleaf project, else the host it is on, if it has one. */
export function remoteLabel(url: string): string | undefined {
	if (/(^|[./@])overleaf\.com\b/i.test(url)) return "Overleaf";
	const host = /^\w+:\/\/(?:[^@/]*@)?([^/:]+)/.exec(url)?.[1] ?? /^[^@]+@([^:]+):/.exec(url)?.[1];
	return host;
}

/** `git status --porcelain=v2 --branch`, read. */
export function readStatus(porcelain: string): Omit<GitStatus, "remote" | "label"> {
	const status: Omit<GitStatus, "remote" | "label"> = { branch: "", ahead: 0, behind: 0, changed: 0 };
	let oid = "";
	for (const line of porcelain.split("\n")) {
		if (line.startsWith("# branch.oid ")) oid = line.slice(13).trim();
		else if (line.startsWith("# branch.head ")) status.branch = line.slice(14).trim();
		else if (line.startsWith("# branch.upstream ")) status.upstream = line.slice(18).trim();
		else if (line.startsWith("# branch.ab ")) {
			const [, ahead, behind] = /\+(\d+) -(\d+)/.exec(line) ?? [];
			status.ahead = Number(ahead ?? 0);
			status.behind = Number(behind ?? 0);
		} else if (/^[12u] /.test(line)) status.changed++;
	}
	if (status.branch === "(detached)" || status.branch === "") status.branch = oid.slice(0, 7) || "no commits";
	return status;
}

export async function gitStatus(file: string): Promise<GitStatus | undefined> {
	const root = await rootOf(file);
	if (!root) return undefined;
	const run = await git(root, ["status", "--porcelain=v2", "--branch", "--untracked-files=no"]);
	if (run.code !== 0) return undefined;
	const status: GitStatus = readStatus(run.out);
	const name = status.upstream?.split("/")[0] ?? "origin";
	const url = await git(root, ["remote", "get-url", name]);
	if (url.code === 0 && url.out.trim()) {
		status.remote = cleanRemote(url.out.trim());
		const label = remoteLabel(url.out.trim());
		if (label) status.label = label;
	}
	return status;
}

/** A sentence for a failed git run: the reasons people actually meet, said plainly, else git's own last line. */
function why(run: Run, label: string): string {
	const out = run.out;
	if (/could not read (Username|Password)|Authentication failed|terminal prompts disabled|Permission denied \(publickey/i.test(out))
		return label === "Overleaf"
			? "Overleaf asked for a login. Make a Git token in Overleaf (Account settings, Git integration) and put it in the remote: https://git:TOKEN@git.overleaf.com/PROJECT."
			: `${label} asked for a login this server does not have. Give the repository a token in its remote address, or a credential helper.`;
	if (/Could not resolve host|unable to access|Connection (timed out|refused)/i.test(out)) return `${label} could not be reached.`;
	if (/no tracking information|no upstream/i.test(out)) return "This branch has no remote branch to pull from or push to.";
	const last = out.trim().split("\n").filter((line) => line.trim()).pop() ?? "";
	return last.replace(/^(fatal|error): /, "") || `git stopped (exit ${run.code}).`;
}

/** Who commits: the repository's own name and address, or Decks when it has none, so a commit is never refused for it. */
async function identity(root: string): Promise<string[]> {
	const named = (await git(root, ["config", "user.email"])).out.trim();
	return named ? [] : ["-c", "user.name=Decks", "-c", "user.email=decks@localhost"];
}

/** Commit what is not committed in the repository's tracked files, and the document itself. */
async function commitAll(root: string, file: string): Promise<Run> {
	await git(root, ["add", "-u"]);
	await git(root, ["add", "--", relative(root, file)]);
	const staged = await git(root, ["diff", "--cached", "--quiet"]);
	if (staged.code === 0) return { code: 0, out: "" };
	return git(root, [...(await identity(root)), "commit", "-q", "-m", MESSAGE]);
}

async function count(root: string, range: string): Promise<number> {
	const run = await git(root, ["rev-list", "--count", range]);
	return run.code === 0 ? Number(run.out.trim()) : 0;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Commit, fetch, merge: the pull, and the first half of a push. */
async function pullInto(file: string): Promise<GitResult & { root?: string; label: string; pulled: number }> {
	const root = await rootOf(file);
	if (!root) return { ok: false, message: "This file is not in a git repository.", label: "the remote", pulled: 0 };
	const status = await gitStatus(file);
	const label = status?.label ?? "the remote";
	if (!status?.upstream) return { ok: false, message: "This branch has no remote branch to pull from or push to.", root, label, pulled: 0, ...(status ? { status } : {}) };
	const commit = await commitAll(root, file);
	if (commit.code !== 0) return { ok: false, message: `Could not commit the edits made here: ${why(commit, label)}`, root, label, pulled: 0, status };
	const fetch = await git(root, ["fetch", "--quiet"]);
	if (fetch.code !== 0) return { ok: false, message: why(fetch, label), root, label, pulled: 0, status };
	const pulled = await count(root, "HEAD..@{upstream}");
	if (pulled === 0) return { ok: true, message: `Up to date with ${label}.`, root, label, pulled };
	const who = await identity(root);
	let merge = await git(root, [...who, "merge", "--no-edit", "@{upstream}"]);
	// Typing that reached the file after the commit: commit it too, and merge again.
	if (merge.code !== 0 && /would be overwritten by merge/.test(merge.out)) {
		await commitAll(root, file);
		merge = await git(root, [...who, "merge", "--no-edit", "@{upstream}"]);
	}
	if (merge.code !== 0) {
		const conflicted = (await git(root, ["diff", "--name-only", "--diff-filter=U"])).out.trim().split("\n").filter(Boolean);
		if (conflicted.length === 0) return { ok: false, message: why(merge, label), root, label, pulled: 0, status: (await gitStatus(file)) ?? status };
		await git(root, ["merge", "--abort"]);
		return { ok: false, message: `${label[0]!.toUpperCase()}${label.slice(1)} and Decks both changed the same lines in ${conflicted.join(", ")}, so nothing was pulled. Your edits are committed here; change those lines on one side and pull again.`, root, label, pulled: 0, status: (await gitStatus(file)) ?? status };
	}
	return { ok: true, message: `Pulled ${plural(pulled, "commit")} from ${label}.`, root, label, pulled };
}

export async function gitPull(file: string): Promise<GitResult> {
	const { ok, message } = await pullInto(file);
	const status = await gitStatus(file);
	return { ok, message, ...(status ? { status } : {}) };
}

export async function gitPush(file: string): Promise<GitResult> {
	const pulled = await pullInto(file);
	if (!pulled.ok || !pulled.root) {
		const status = await gitStatus(file);
		return { ok: false, message: pulled.message, ...(status ? { status } : {}) };
	}
	const root = pulled.root;
	const sending = await count(root, "@{upstream}..HEAD");
	let message = pulled.pulled > 0 ? `${pulled.message} ` : "";
	if (sending === 0) message += `Nothing to push: ${pulled.label} has everything.`;
	else {
		const push = await git(root, ["push", "--quiet"]);
		if (push.code !== 0) {
			const status = await gitStatus(file);
			return { ok: false, message: message + why(push, pulled.label), ...(status ? { status } : {}) };
		}
		message += `Pushed ${plural(sending, "commit")} to ${pulled.label}.`;
	}
	const status = await gitStatus(file);
	return { ok: true, message, ...(status ? { status } : {}) };
}

export const gitSync = { status: gitStatus, pull: gitPull, push: gitPush };
