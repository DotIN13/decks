import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cleanRemote, gitPull, gitPush, gitStatus, readStatus, remoteLabel } from "./git.ts";

const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** A bare remote, "here" (the clone Decks edits) and "there" (Overleaf, or a collaborator). */
function repos() {
	const top = realpathSync(mkdtempSync(join(tmpdir(), "decks-git-")));
	const remote = join(top, "remote.git");
	sh(top, "init", "-q", "--bare", "-b", "master", remote);
	const there = join(top, "there");
	sh(top, "clone", "-q", remote, there);
	sh(there, "config", "user.email", "there@example.com");
	sh(there, "config", "user.name", "There");
	writeFileSync(join(there, "main.tex"), "\\section{One}\nFirst line.\n\nSecond line.\n");
	sh(there, "add", ".");
	sh(there, "commit", "-q", "-m", "start");
	sh(there, "push", "-q", "origin", "master");
	const here = join(top, "here");
	sh(top, "clone", "-q", remote, here);
	const done = () => rmSync(top, { recursive: true, force: true });
	return { top, remote, there, here, done };
}

test("status reads the branch, the upstream and what is ahead, and a file outside any repository has none", async () => {
	const { top, here, done } = repos();
	writeFileSync(join(here, "main.tex"), "changed\n");
	const status = await gitStatus(join(here, "main.tex"));
	assert.equal(status?.branch, "master");
	assert.equal(status?.upstream, "origin/master");
	assert.equal(status?.changed, 1);
	writeFileSync(join(top, "loose.tex"), "x");
	assert.equal(await gitStatus(join(top, "loose.tex")), undefined);
	done();
});

test("a pull commits what was typed here and merges what changed there", async () => {
	const { here, there, done } = repos();
	writeFileSync(join(there, "main.tex"), "\\section{One}\nFirst line, from Overleaf.\n\nSecond line.\n");
	sh(there, "commit", "-qam", "on overleaf");
	sh(there, "push", "-q");
	writeFileSync(join(here, "main.tex"), "\\section{One}\nFirst line.\n\nSecond line, typed in Decks.\n");
	const result = await gitPull(join(here, "main.tex"));
	assert.equal(result.ok, true, result.message);
	assert.match(result.message, /Pulled 1 commit/);
	assert.equal(readFileSync(join(here, "main.tex"), "utf8"), "\\section{One}\nFirst line, from Overleaf.\n\nSecond line, typed in Decks.\n");
	assert.equal(result.status?.changed, 0);
	assert.match(sh(here, "log", "--format=%s"), /Edited in Decks/);
	done();
});

test("a push pulls first, then sends the commits, and the other side gets them", async () => {
	const { here, there, done } = repos();
	writeFileSync(join(there, "notes.tex"), "a new file there\n");
	sh(there, "add", ".");
	sh(there, "commit", "-qm", "notes");
	sh(there, "push", "-q");
	writeFileSync(join(here, "main.tex"), "\\section{One}\nFirst line.\n\nSecond line, from Decks.\n");
	const result = await gitPush(join(here, "main.tex"));
	assert.equal(result.ok, true, result.message);
	assert.match(result.message, /Pulled 1 commit.*Pushed 2 commits/);
	assert.equal(result.status?.ahead, 0);
	sh(there, "pull", "-q", "--no-rebase");
	assert.match(readFileSync(join(there, "main.tex"), "utf8"), /from Decks/);
	assert.equal((await gitPush(join(here, "main.tex"))).message, "Up to date with the remote. Nothing to push: the remote has everything.".replace("Up to date with the remote. ", ""));
	done();
});

test("when both sides changed the same line, nothing is pulled, the merge is called off, and the edit is kept as a commit", async () => {
	const { here, there, done } = repos();
	writeFileSync(join(there, "main.tex"), "\\section{One}\nFirst line THERE.\n\nSecond line.\n");
	sh(there, "commit", "-qam", "there");
	sh(there, "push", "-q");
	writeFileSync(join(here, "main.tex"), "\\section{One}\nFirst line HERE.\n\nSecond line.\n");
	const result = await gitPull(join(here, "main.tex"));
	assert.equal(result.ok, false);
	assert.match(result.message, /both changed the same lines in main\.tex/);
	assert.equal(readFileSync(join(here, "main.tex"), "utf8"), "\\section{One}\nFirst line HERE.\n\nSecond line.\n");
	assert.equal(existsSync(join(here, ".git", "MERGE_HEAD")), false);
	assert.equal(result.status?.changed, 0);
	done();
});

test("a branch with no remote branch says so instead of failing in git's words", async () => {
	const { here, done } = repos();
	sh(here, "checkout", "-q", "-b", "local-only");
	const result = await gitPull(join(here, "main.tex"));
	assert.equal(result.ok, false);
	assert.match(result.message, /no remote branch/);
	done();
});

test("a remote's address loses its token before it is shown, and Overleaf is named", () => {
	assert.equal(cleanRemote("https://git:olp_abc123@git.overleaf.com/64f0"), "https://git.overleaf.com/64f0");
	assert.equal(remoteLabel("https://git:tok@git.overleaf.com/64f0"), "Overleaf");
	assert.equal(remoteLabel("git@github.com:me/paper.git"), "github.com");
	assert.equal(remoteLabel("/tmp/remote.git"), undefined);
	assert.deepEqual(readStatus("# branch.oid abc1234def\n# branch.head (detached)\n1 .M N... 100644 100644 100644 a b main.tex\n"), { branch: "abc1234", ahead: 0, behind: 0, changed: 1 });
});
