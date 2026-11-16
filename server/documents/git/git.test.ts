import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Refused } from "../../../protocol/index.ts";
import { folderRunner } from "../../kernel/run.ts";
import { Repos } from "./repo.ts";
import { cleanRemote, readStatus, remoteLabel, why } from "./status.ts";

// Tests from the README's rules: reading git's words alone, then real git on scratch folders
// with a bare remote beside them (no network); what needs a real remote's refusal is read as words.

const scratch = mkdtempSync(join(tmpdir(), "quire-git-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const hasGit = (() => {
	try {
		execFileSync("git", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();
const ENV = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** A deck folder holding papers/ cloned from a bare remote, and a second clone standing for Overleaf. */
function world(name: string) {
	const root = join(scratch, name);
	const bare = join(root + "-remote.git");
	const other = join(root + "-other");
	mkdirSync(root, { recursive: true });
	git(scratch, "init", "-q", "--bare", "-b", "main", bare);
	git(scratch, "clone", "-q", bare, other);
	writeFileSync(join(other, "paper.tex"), "line one\nline two\n");
	git(other, "add", ".");
	git(other, "commit", "-q", "-m", "start");
	git(other, "push", "-q", "origin", "HEAD:main");
	git(root, "clone", "-q", bare, "papers");
	return { root, other, repos: new Repos(() => folderRunner(root)) };
}

test("rules 2 and 3: git status read; the remote cleaned and named", () => {
	const s = readStatus(["# branch.oid abcdef1234", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +2 -1", "1 .M N... 100644 a", "1 M. N... 100644 b"].join("\n"));
	assert.deepEqual(s, { branch: "main", upstream: "origin/main", ahead: 2, behind: 1, changed: 2 });
	assert.equal(readStatus("# branch.oid abcdef1234\n# branch.head (detached)").branch, "abcdef1");
	assert.equal(readStatus("# branch.oid (initial)\n# branch.head main").branch, "main");
	assert.equal(cleanRemote("https://git:SECRET@git.overleaf.com/abc"), "https://git.overleaf.com/abc");
	assert.equal(remoteLabel("https://git:t@git.overleaf.com/abc"), "Overleaf");
	assert.equal(remoteLabel("git@github.com:me/paper.git"), "github.com");
});

test("rule 9: a login failure says how to give one, for Overleaf in its own words", () => {
	assert.match(why({ code: 128, out: "fatal: could not read Username for 'https://git.overleaf.com'" }, "Overleaf"), /Git token in Overleaf/);
	assert.match(why({ code: 128, out: "fatal: Authentication failed" }, "github.com"), /^github.com asked for a login/);
	assert.equal(why({ code: 128, out: "fatal: Could not resolve host: x" }, "x.org"), "x.org could not be reached.");
});

test("rule 13: no machine is unavailable", async () => {
	await assert.rejects(new Repos(() => undefined).repo("a.tex"), (e: Refused) => e.code === "unavailable");
});

test("rule 1: a file in no repository has none; pull is not_found", { skip: !hasGit && "git is not installed" }, async () => {
	const root = join(scratch, "plain");
	mkdirSync(join(root, "papers"), { recursive: true });
	const repos = new Repos(() => folderRunner(root));
	assert.equal(await repos.repo("papers/a.tex"), null);
	await assert.rejects(repos.pull("papers/a.tex"), (e: Refused) => e.code === "not_found");
});

test("rule 1: a repository whose top is above the deck is none of the deck's", { skip: !hasGit && "git is not installed" }, async () => {
	const outer = join(scratch, "outer");
	mkdirSync(join(outer, "deck", "papers"), { recursive: true });
	git(outer, "init", "-q");
	const repos = new Repos(() => folderRunner(join(outer, "deck")));
	assert.equal(await repos.repo("papers/a.tex"), null);
});

test("rule 2: file.repo reads branch, upstream, remote and edits not committed", { skip: !hasGit && "git is not installed" }, async () => {
	const { root, repos } = world("status");
	writeFileSync(join(root, "papers/paper.tex"), "line one\nline two\nmore\n");
	const status = await repos.repo("papers/paper.tex");
	assert.equal(status?.branch, "main");
	assert.equal(status?.upstream, "origin/main");
	assert.equal(status?.changed, 1);
	assert.equal(status?.ahead, 0);
	assert.ok(status?.remote?.endsWith("status-remote.git"));
});

test("rule 8: a branch with no upstream is refused as conflict", { skip: !hasGit && "git is not installed" }, async () => {
	const root = join(scratch, "alone");
	mkdirSync(join(root, "papers"), { recursive: true });
	git(join(root, "papers"), "init", "-q");
	await assert.rejects(new Repos(() => folderRunner(root)).push("papers/a.tex"), (e: Refused) => e.code === "conflict");
});

test("rules 4 and 6: a push commits what was typed as Edited in Decks, then sends it", { skip: !hasGit && "git is not installed" }, async () => {
	const { root, other, repos } = world("push");
	writeFileSync(join(root, "papers/paper.tex"), "line one\nline two\ntyped here\n");
	const done = await repos.push("papers/paper.tex");
	assert.equal(done.ok, true, done.message);
	assert.match(done.message, /Pushed 1 commit to/);
	assert.deepEqual([done.status?.ahead, done.status?.changed], [0, 0]);
	git(other, "pull", "-q");
	assert.match(readFileSync(join(other, "paper.tex"), "utf8"), /typed here/);
	assert.match(git(other, "log", "-1", "--format=%s %an"), /^Edited in Decks/);
	assert.match((await repos.push("papers/paper.tex")).message, /Nothing to push/);
});

test("rule 4: a pull merges the remote's commits with what was typed here", { skip: !hasGit && "git is not installed" }, async () => {
	const { root, other, repos } = world("pull");
	writeFileSync(join(other, "paper.tex"), "line one\nline two\n\nadded remotely\n");
	git(other, "commit", "-q", "-am", "remote");
	git(other, "push", "-q");
	writeFileSync(join(root, "papers/paper.tex"), "typed first\nline one\nline two\n");
	const done = await repos.pull("papers/paper.tex");
	assert.equal(done.ok, true, done.message);
	assert.match(done.message, /^Pulled 1 commit from/);
	const text = readFileSync(join(root, "papers/paper.tex"), "utf8");
	assert.match(text, /typed first/);
	assert.match(text, /added remotely/);
});

test("rule 5: a merge on lines both sides changed is called off, and nothing typed is lost", { skip: !hasGit && "git is not installed" }, async () => {
	const { root, other, repos } = world("clash");
	writeFileSync(join(other, "paper.tex"), "line one\nTHEIRS\n");
	git(other, "commit", "-q", "-am", "remote");
	git(other, "push", "-q");
	writeFileSync(join(root, "papers/paper.tex"), "line one\nOURS\n");
	const done = await repos.pull("papers/paper.tex");
	assert.equal(done.ok, false);
	assert.match(done.message, /both changed the same lines in paper\.tex/);
	assert.equal(readFileSync(join(root, "papers/paper.tex"), "utf8"), "line one\nOURS\n");
	assert.equal(git(join(root, "papers"), "status", "--porcelain"), "");
});
