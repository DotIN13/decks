import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkCloneUrl, cloneRepo, GITIGNORE, initRepo, isRepo, nameFromUrl, repoState } from "./repo.ts";
import { writeStarter } from "./starters.ts";

/** A scratch folder, and git told to read no config but this test's: no name, no email, no hooks. */
async function withScratch(run: (dir: string) => Promise<void>) {
	const dir = mkdtempSync(join(tmpdir(), "app-repo-"));
	const saved = { HOME: process.env.HOME, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
	const home = join(dir, "home");
	mkdirSync(home);
	writeFileSync(join(home, ".gitconfig"), "");
	process.env.HOME = home;
	process.env.GIT_CONFIG_GLOBAL = join(home, ".gitconfig");
	process.env.GIT_CONFIG_NOSYSTEM = "1";
	try {
		await run(dir);
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(dir, { recursive: true, force: true });
	}
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

test("a new app's folder becomes a repository on main with one commit, under Decks' name when git has none", async () => {
	await withScratch(async (dir) => {
		const folder = join(dir, "polls");
		writeStarter(folder, "node", "Polls");
		const made = await initRepo(folder, "Start Polls from the node starter");
		assert.ok(isRepo(folder));
		assert.equal(made.branch, "main");
		assert.match(made.head, /^[0-9a-f]{7,}$/);
		assert.equal(made.dirty, 0, "everything is committed");
		assert.equal(made.remote, undefined);
		assert.equal(git(folder, "rev-list", "--count", "HEAD"), "1");
		assert.equal(git(folder, "log", "-1", "--format=%s|%an|%ae"), "Start Polls from the node starter|Decks|decks@localhost");
		assert.equal(readFileSync(join(folder, ".gitignore"), "utf8"), GITIGNORE);
		assert.ok(git(folder, "ls-files").split("\n").includes(".gitignore"));
	});
});

test("the person's own git name is used when git has one, and a .gitignore already there is kept", async () => {
	await withScratch(async (dir) => {
		writeFileSync(process.env.GIT_CONFIG_GLOBAL!, "[user]\n\tname = Ada\n\temail = ada@example.com\n");
		const folder = join(dir, "notes");
		mkdirSync(folder);
		writeFileSync(join(folder, "app.json"), '{"kind":"static"}');
		writeFileSync(join(folder, ".gitignore"), "secret.txt\n");
		writeFileSync(join(folder, "secret.txt"), "shh");
		writeFileSync(join(folder, ".env"), "TOKEN=1");
		await initRepo(folder, "Keep notes in git");
		assert.equal(git(folder, "log", "-1", "--format=%an|%ae"), "Ada|ada@example.com");
		assert.equal(readFileSync(join(folder, ".gitignore"), "utf8"), "secret.txt\n");
		const tracked = git(folder, "ls-files").split("\n");
		assert.ok(!tracked.includes("secret.txt"));
		writeFileSync(join(folder, "index.html"), "<p>hi</p>");
		assert.equal((await repoState(folder)).dirty, 1, "a new file is counted");
	});
});

test("the starter's .gitignore leaves out secrets, builds and installs", async () => {
	await withScratch(async (dir) => {
		const folder = join(dir, "shop");
		writeStarter(folder, "static", "Shop");
		for (const [path, text] of [[".env", "A=1"], [".env.local", "B=2"], ["node_modules/x/index.js", ""], ["dist/a.js", ""], ["debug.log", ""]]) {
			mkdirSync(join(folder, path, ".."), { recursive: true });
			writeFileSync(join(folder, path), text);
		}
		await initRepo(folder, "Start");
		const tracked = git(folder, "ls-files").split("\n");
		for (const left of [".env", ".env.local", "node_modules/x/index.js", "dist/a.js", "debug.log"]) assert.ok(!tracked.includes(left), `${left} is not committed`);
	});
});

test("only https and git@host:path addresses may be cloned", () => {
	for (const ok of ["https://github.com/someone/polls.git", "https://gitlab.example.com:8443/team/sub/polls", "git@github.com:someone/polls.git", "git@host.example:polls"]) assert.equal(checkCloneUrl(ok), ok);
	for (const bad of [
		"",
		"file:///etc",
		"/Users/someone/repo",
		"../repo",
		"ext::sh -c touch% /tmp/pwned",
		"-x",
		"--upload-pack=touch /tmp/x",
		"http://github.com/someone/polls.git",
		"ssh://git@github.com/someone/polls.git",
		"git://github.com/someone/polls.git",
		"https://-oProxyCommand=x/y",
		"git@-oProxyCommand=x:y",
		"git@github.com:-x",
		"https://github.com/a b",
		"https://github.com/a\nb",
	])
		assert.throws(() => checkCloneUrl(bad), undefined, JSON.stringify(bad));
});

test("an app's name comes from the address's last part, as an app name is written", () => {
	assert.equal(nameFromUrl("https://github.com/someone/Trip_Planner.git"), "trip-planner");
	assert.equal(nameFromUrl("git@github.com:someone/polls.git"), "polls");
	assert.equal(nameFromUrl("git@host:polls"), "polls");
	assert.equal(nameFromUrl("https://github.com/someone/polls/"), "polls");
	assert.equal(nameFromUrl("https://github.com/someone/.hidden.git"), "hidden");
	assert.equal(nameFromUrl("https://github.com/someone/___.git"), undefined);
	assert.equal(nameFromUrl(`https://github.com/someone/${"a".repeat(80)}.git`)!.length, 48);
});

test("a clone of a repository on disk works only when a test asks for it, and a failed one leaves no folder", async () => {
	await withScratch(async (dir) => {
		const source = join(dir, "source");
		writeStarter(source, "static", "Polls");
		await initRepo(source, "Start");
		const bare = join(dir, "polls.git");
		git(dir, "clone", "-q", "--bare", source, bare);

		await assert.rejects(cloneRepo(bare, join(dir, "apps", "refused")), /Only an https/);
		assert.ok(!existsSync(join(dir, "apps", "refused")));

		const into = join(dir, "apps", "polls");
		const cloned = await cloneRepo(bare, into, { allowLocal: true });
		assert.equal(cloned.branch, "main");
		assert.equal(cloned.head, git(source, "rev-parse", "--short", "HEAD"));
		assert.equal(cloned.remote, bare);
		assert.ok(existsSync(join(into, "app.json")));

		await assert.rejects(cloneRepo(bare, into, { allowLocal: true }), /already exists/);
		const missing = join(dir, "apps", "missing");
		await assert.rejects(cloneRepo(join(dir, "nowhere.git"), missing, { allowLocal: true }), /git clone failed/);
		assert.ok(!existsSync(missing), "the half-made folder is gone");
	});
});
