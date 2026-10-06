import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AVATAR_LIMIT, checkAvatar } from "./avatar.ts";

test("an avatar with no xmlns gets one, and is told so", () => {
	// The exact shape the reminder used to show, which is what agents copied.
	const checked = checkAvatar('<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#0f9ba8"/></svg>');
	assert.match(checked.svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, "stored with the namespace");
	assert.match(checked.svg, /viewBox="0 0 64 64"/, "and with everything it was drawn with");
	assert.match(checked.svg, /<circle cx="32"/);
	assert.match(String(checked.changed), /xmlns/, "and the agent is told what changed");
});

test("an avatar that is already right is stored exactly as it came", () => {
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>';
	const checked = checkAvatar(svg);
	assert.equal(checked.svg, svg);
	assert.equal(checked.changed, undefined, "nothing to say");
});

test("a viewBox is taken from the width and height when it is the only thing missing", () => {
	const checked = checkAvatar('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle r="20"/></svg>');
	assert.match(checked.svg, /viewBox="0 0 48 48"/);
	assert.match(String(checked.changed), /viewBox/);
});

test("an xml declaration and comments before the root are kept, and the root is still repaired", () => {
	const checked = checkAvatar('<?xml version="1.0"?>\n<!-- a teapot --><svg viewBox="0 0 10 10"><path d="M0 0h10"/></svg>');
	assert.match(checked.svg, /^<\?xml version="1\.0"\?>/);
	assert.match(checked.svg, /<!-- a teapot -->/);
	assert.match(checked.svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 10 10"/);
});

test("what cannot be repaired is refused with a sentence that says what to do", () => {
	const refused = (svg: string) => {
		try {
			checkAvatar(svg);
			return "";
		} catch (error) {
			return (error as Error).message;
		}
	};
	assert.match(refused(""), /cannot be empty/);
	assert.match(refused("a circle, blue"), /must start with <svg>/);
	assert.match(refused('<div><svg viewBox="0 0 8 8"/></div>'), /must start with <svg>/);
	// No size at all: nothing in the file says how big the drawing is, so it cannot be scaled.
	assert.match(refused("<svg><circle r=\"4\"/></svg>"), /needs a viewBox/);
	assert.match(refused('<svg viewBox="0 0 8 8"><script>fetch("/x")</script></svg>'), /cannot carry a <script>/);
	assert.match(refused('<svg viewBox="0 0 8 8" onload="fetch(1)"></svg>'), /event handler/);
	assert.match(refused('<svg viewBox="0 0 8 8"><a href="javascript:1">x</a></svg>'), /javascript:/);
	assert.match(refused(`<svg viewBox="0 0 8 8">${"<path d='M0 0h1'/>".repeat(9000)}</svg>`), /small drawing/);
	assert.ok(AVATAR_LIMIT > 1024, "the limit leaves room for a detailed drawing");
});

test("the emoji avatar the tool writes is already valid, so the check leaves it alone", () => {
	// The same markup as `stage.me`'s emoji branch (`stage/tool.ts`).
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="44" font-size="44" text-anchor="middle">🫖</text></svg>';
	const checked = checkAvatar(svg);
	assert.equal(checked.svg, svg);
	assert.equal(checked.changed, undefined);
});

/*
 * And through the service, which is the path `stage.me` takes: what lands on disk is what the
 * browser is served, so this is the assertion that actually pins the bug.
 */
test("writeAvatar puts the repaired svg on disk and hands back what changed", async () => {
	const { StageService } = await import("./service.ts");
	const data = mkdtempSync(join(tmpdir(), "decks-avatar-"));
	try {
		const service = new StageService({ path: data } as never, {} as never);
		const written = service.writeAvatar("agent-1", '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/></svg>');
		assert.match(written.url, /^\/api\/avatar\/agent-1\?rev=/);
		assert.match(String(written.changed), /xmlns/);
		const onDisk = readFileSync(join(data, ".decks", "avatars", "agent-1.svg"), "utf8");
		assert.match(onDisk, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, "the file the browser is served has the namespace");
	} finally {
		rmSync(data, { recursive: true, force: true });
	}
});
