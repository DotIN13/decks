// The layers built once, tested in Solid's browser build: a signal read at a builder's top does not rebuild it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

/** Run `body` in a node with Solid's browser build (the test runner's own is the server build, which never re-runs). */
function inBrowserSolid(body: string): number {
	const script = `const s = await import("solid-js"); const { builtOnce } = await import(${JSON.stringify(new URL("./built-once.ts", import.meta.url).href)}); ${body}`;
	const out = execFileSync(process.execPath, ["--conditions=browser", "--import", "tsx", "--input-type=module", "-e", script], { encoding: "utf8" });
	return Number(out.trim());
}

const effect = (wrap: string) => `
	const [read, write] = s.createSignal(0);
	let builds = 0;
	const make = () => { read(); builds++; return builds; };
	s.createRoot(() => s.createRenderEffect(() => ${wrap}));
	write(1); write(2);
	console.log(builds);
`;

test("a builder called in a render effect rebuilds when a signal it reads changes", () => {
	assert.equal(inBrowserSolid(effect("make()")), 3);
});

test("built once, the same builder is not rebuilt by that signal", () => {
	assert.equal(inBrowserSolid(effect("builtOnce(make)")), 1);
});
