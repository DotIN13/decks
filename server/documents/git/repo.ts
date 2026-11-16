import { Refused } from "../../../protocol/index.ts";
import { toDeckPath, type DeckPath, type RunJob, type RunResult } from "../../kernel/types.ts";
import { capital, cleanRemote, plural, readStatus, remoteLabel, why, type DocRepo, type GitRun } from "./status.ts";

// A document's git repository: read it, pull it (commit first, then merge), push it (pull first, then send).

export type Run = (job: RunJob) => Promise<RunResult>;
export type Synced = { ok: boolean; message: string; status?: DocRepo };

const TIMEOUT_MS = 90_000;
const MESSAGE = "Edited in Decks";
/** Git never prompts, and speaks English we can read (rule 9). */
const QUIET = { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "", GIT_SSH_COMMAND: "ssh -o BatchMode=yes", LC_ALL: "C" };

/** A repository whose top folder is inside the deck: that folder, and the document's path from it. */
type Found = { top: DeckPath | ""; file: string; git: (args: string[]) => Promise<GitRun> };

/** One per server: pulls and pushes of one repository run one at a time (rule 10). */
export class Repos {
	private queues = new Map<string, Promise<unknown>>();

	constructor(private machine: () => Run | undefined) {}

	/** The repository the document is in, or null (rules 1, 2). */
	async repo(raw: string): Promise<DocRepo | null> {
		const found = await this.find(raw);
		return found ? statusOf(found) : null;
	}

	async pull(raw: string): Promise<Synced> {
		const found = await this.needed(raw);
		return this.queued(found.top, async () => {
			const pulled = await pullInto(found);
			return { ok: pulled.ok, message: pulled.message, ...(await withStatus(found)) };
		});
	}

	async push(raw: string): Promise<Synced> {
		const found = await this.needed(raw);
		return this.queued(found.top, async () => {
			const pulled = await pullInto(found);
			if (!pulled.ok) return { ok: false, message: pulled.message, ...(await withStatus(found)) };
			const sent = await send(found, pulled.label);
			const message = [pulled.count > 0 ? pulled.message : "", sent.message].filter(Boolean).join(" ");
			return { ok: sent.ok, message, ...(await withStatus(found)) };
		});
	}

	/** Pull and push need a repository with an upstream (rules 1, 8). */
	private async needed(raw: string): Promise<Found> {
		const found = await this.find(raw);
		if (!found) throw new Refused("not_found", `${raw} is not in a git repository inside the deck.`, "file.repo");
		if (!(await statusOf(found))?.upstream) throw new Refused("conflict", "This branch has no remote branch to pull from or push to.", "file.repo");
		return found;
	}

	private queued<T>(top: string, work: () => Promise<T>): Promise<T> {
		const next = (this.queues.get(top) ?? Promise.resolve()).then(work, work);
		const settled = next.then(() => undefined, () => undefined);
		this.queues.set(top, settled);
		void settled.then(() => this.queues.get(top) === settled && this.queues.delete(top));
		return next;
	}

	/** Ask git where the top is, as ups from the document's folder; above the deck is none (rule 1). */
	private async find(raw: string): Promise<Found | undefined> {
		const path = toDeckPath(raw);
		const run = this.machine();
		if (!run) throw new Refused("unavailable", "This server has no machine to run git on.", "file.read");
		const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		const parts = folder ? folder.split("/") : [];
		const cdup = await gitIn(run, folder as DeckPath | "", ["rev-parse", "--show-cdup"]);
		if (cdup.code !== 0) return undefined;
		const ups = cdup.out.trim().split("/").filter((p) => p === "..").length;
		if (ups > parts.length) return undefined;
		const top = parts.slice(0, parts.length - ups).join("/") as DeckPath | "";
		return { top, file: top ? path.slice(top.length + 1) : path, git: (args) => gitIn(run, top, args) };
	}
}

/** One git run in a deck folder, quiet, stopped after 90 seconds. */
async function gitIn(run: Run, cwd: DeckPath | "", args: string[]): Promise<GitRun> {
	const done = await run({ command: ["git"], args, cwd, env: QUIET, timeoutMs: TIMEOUT_MS });
	if (done.missing) return { code: -1, out: "git is not installed on this server." };
	if (done.signal) return { code: -1, out: `git took longer than ${TIMEOUT_MS / 1000} s and was stopped.` };
	return { code: done.code, out: done.out };
}

async function statusOf(found: Found): Promise<DocRepo | null> {
	const run = await found.git(["status", "--porcelain=v2", "--branch", "--untracked-files=no"]);
	if (run.code !== 0) return null;
	const status = readStatus(run.out);
	const url = await found.git(["remote", "get-url", status.upstream?.split("/")[0] ?? "origin"]);
	const address = url.code === 0 ? url.out.trim() : "";
	if (!address) return status;
	const label = remoteLabel(address);
	return { ...status, remote: cleanRemote(address), ...(label ? { label } : {}) };
}

async function withStatus(found: Found): Promise<{ status?: DocRepo }> {
	const status = await statusOf(found);
	return status ? { status } : {};
}

/** Who commits: the repository's own name, else Decks, so a commit is never refused for it (rule 4). */
async function identity(found: Found): Promise<string[]> {
	const named = (await found.git(["config", "user.email"])).out.trim();
	return named ? [] : ["-c", "user.name=Decks", "-c", "user.email=decks@localhost"];
}

/** Commit the tracked files' edits and the document itself, if anything changed (rule 4). */
async function commitAll(found: Found): Promise<GitRun> {
	await found.git(["add", "-u"]);
	await found.git(["add", "--", found.file]);
	if ((await found.git(["diff", "--cached", "--quiet"])).code === 0) return { code: 0, out: "" };
	return found.git([...(await identity(found)), "commit", "-q", "-m", MESSAGE]);
}

async function count(found: Found, range: string): Promise<number> {
	const run = await found.git(["rev-list", "--count", range]);
	return run.code === 0 ? Number(run.out.trim()) : 0;
}

type Pulled = { ok: boolean; message: string; label: string; count: number };

/** Commit, fetch, merge; a merge that stops on lines both sides changed is called off (rules 4, 5). */
async function pullInto(found: Found): Promise<Pulled> {
	const label = (await statusOf(found))?.label ?? "the remote";
	const fail = (message: string): Pulled => ({ ok: false, message, label, count: 0 });
	const commit = await commitAll(found);
	if (commit.code !== 0) return fail(`Could not commit the edits made here: ${why(commit, label)}`);
	const fetch = await found.git(["fetch", "--quiet"]);
	if (fetch.code !== 0) return fail(why(fetch, label));
	const pulled = await count(found, "HEAD..@{upstream}");
	if (pulled === 0) return { ok: true, message: `Up to date with ${label}.`, label, count: 0 };
	const merge = await mergeUpstream(found);
	if (merge.code === 0) return { ok: true, message: `Pulled ${plural(pulled, "commit")} from ${label}.`, label, count: pulled };
	const both = (await found.git(["diff", "--name-only", "--diff-filter=U"])).out.trim().split("\n").filter(Boolean);
	if (both.length === 0) return fail(why(merge, label));
	await found.git(["merge", "--abort"]);
	return fail(`${capital(label)} and Decks both changed the same lines in ${both.join(", ")}, so nothing was pulled. Your edits are committed here; change those lines on one side and pull again.`);
}

/** Merge the upstream; typing that reached the file after the commit is committed too, and merged again. */
async function mergeUpstream(found: Found): Promise<GitRun> {
	const who = await identity(found);
	const merge = await found.git([...who, "merge", "--no-edit", "@{upstream}"]);
	if (merge.code === 0 || !/would be overwritten by merge/.test(merge.out)) return merge;
	await commitAll(found);
	return found.git([...who, "merge", "--no-edit", "@{upstream}"]);
}

/** Send what the remote lacks; nothing to send says so (rule 6). */
async function send(found: Found, label: string): Promise<{ ok: boolean; message: string }> {
	const sending = await count(found, "@{upstream}..HEAD");
	if (sending === 0) return { ok: true, message: `Nothing to push: ${label} has everything.` };
	const push = await found.git(["push", "--quiet"]);
	if (push.code !== 0) return { ok: false, message: why(push, label) };
	return { ok: true, message: `Pushed ${plural(sending, "commit")} to ${label}.` };
}
