import { test } from "node:test";
import assert from "node:assert/strict";
import { verdict } from "./check.ts";
import { secretEnv } from "./machine.ts";
import { folderOf, parseManifest } from "./manifest.ts";
import { forwardTarget } from "./ports.ts";
import { underBase, withoutPass } from "./proxy.ts";
import { cloneable, nameFromUrl } from "./repo.ts";
import { candidates, parseAppPath } from "./serve.ts";
import { STARTERS, STARTER_KIND, starterFiles } from "./starters.ts";

// The README's rules, module by module, with no process and no disk.

test("rule 1: a name is lower-case letters, digits and dashes; kind defaults to static", () => {
	assert.equal(folderOf("trip-planner"), "apps/trip-planner");
	assert.throws(() => folderOf("Trip"), /lower-case/);
	assert.throws(() => folderOf("../x"), /lower-case/);
	assert.deepEqual(parseManifest("a", '{"title":" T ","kind":"weird","x":1}'), { kind: "static", title: "T" });
	assert.deepEqual(parseManifest("a", '{"kind":"server","start":"node s.js","prefix":true,"idleMinutes":3}'), { kind: "server", start: "node s.js", prefix: true, idleMinutes: 3 });
	assert.throws(() => parseManifest("a", "{"), /not JSON/);
	assert.throws(() => parseManifest("a", '{"root":"../out"}'), /outside the app/);
});

test("rule 4: an app's commands inherit no secret and none of Decks's own variables", () => {
	for (const name of ["ANTHROPIC_API_KEY", "GH_TOKEN", "MY_SECRET", "DECKS_TOKEN", "DECKS_STUDIO_KEY", "DB_PASSWORD"]) assert.ok(secretEnv(name), name);
	for (const name of ["PATH", "HOME", "LANG"]) assert.ok(!secretEnv(name), name);
});

test("rule 6: an app's address and the files a path names", () => {
	assert.deepEqual(parseAppPath("/app/notes/a/b.js"), { name: "notes", inner: "/a/b.js", slash: true });
	assert.deepEqual(parseAppPath("/app/notes"), { name: "notes", inner: "/", slash: false });
	assert.equal(parseAppPath("/app/No/"), undefined);
	assert.deepEqual(candidates("/"), ["index.html"]);
	assert.deepEqual(candidates("/style.css"), ["style.css", "style.css/index.html"]);
	assert.deepEqual(candidates("/docs/"), ["docs", "docs/index.html", "index.html"]);
	assert.deepEqual(candidates("/.git/config"), []);
	assert.deepEqual(candidates("/%E0%A4%A"), []);
});

test("rule 6: the pass never reaches the app, and a redirect stays under the app", () => {
	assert.equal(withoutPass("/x", "?pass=abc&q=1"), "/x?q=1");
	assert.equal(withoutPass("/x", "?pass=abc"), "/x");
	assert.equal(underBase("/login", "/app/a"), "/app/a/login");
	assert.equal(underBase("/app/a/login", "/app/a"), "/app/a/login");
	assert.equal(underBase("https://x.org/", "/app/a"), "https://x.org/");
	assert.equal(underBase("//x.org/", "/app/a"), "//x.org/");
});

test("rule 8: every starter has an app.json of its kind; clone takes only https and git addresses", () => {
	for (const starter of STARTERS) {
		const files = starterFiles(starter, "My <tool>");
		assert.equal(parseManifest("a", files["app.json"]!).kind, STARTER_KIND[starter], starter);
		const markup = Object.entries(files).filter(([path]) => /\.(html|jsx)$/.test(path) && !path.includes("layout"));
		assert.ok(markup.length && markup.every(([, text]) => !text.includes("My <tool>") && text.includes("My &lt;tool&gt;")), `${starter} escapes the title in markup`);
	}
	assert.ok(cloneable("https://github.com/a/b.git"));
	assert.ok(cloneable("git@github.com:a/b.git"));
	assert.ok(!cloneable("file:///etc"));
	assert.ok(!cloneable("/tmp/repo"));
	assert.ok(!cloneable("--upload-pack=x"));
	assert.equal(nameFromUrl("https://github.com/Me/Trip_Planner.git"), "trip-planner");
});

test("rule 10: the verdict says the worst thing first", () => {
	assert.equal(verdict({ status: 500, title: "", words: 0, errors: ["x"], failed: [] }), "The page answered 500.");
	assert.equal(verdict({ status: 200, title: "", words: 3, errors: ["x", "y"], failed: [] }), "The page threw 2 errors.");
	assert.equal(verdict({ status: 200, title: "", words: 3, errors: [], failed: ["a"] }), "1 request failed.");
	assert.equal(verdict({ status: 200, title: "", words: 0, errors: [], failed: [] }), "The page loaded but shows no words.");
	assert.match(verdict({ status: 200, title: "t", words: 3, errors: [], failed: [] }), /Loads clean/);
});

test("rule 11: /node keeps the address's path, /rnode strips it", () => {
	assert.deepEqual(forwardTarget("/node/localhost/8766/a?b"), { port: 8766, path: "/node/localhost/8766/a?b" });
	assert.deepEqual(forwardTarget("/rnode/localhost/8766/a"), { port: 8766, path: "/a" });
	assert.deepEqual(forwardTarget("/rnode/localhost/8766"), { port: 8766, path: "/" });
	assert.equal(forwardTarget("/node/localhost/70000/"), undefined);
});
