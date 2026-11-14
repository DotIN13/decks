import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testServer } from "../kernel/testing.ts";
import { canvasFeature } from "../canvas/feature.ts";
import { cards } from "../cards/feature.ts";
import { frameFeature } from "./feature.ts";

// The page is public; a pass needs the person's token and opens one canvas's files only.

const deck = {
	"canvases/plan/canvas.pen": JSON.stringify({ version: "2.14", children: [] }),
	"canvases/plan/canvas.json": JSON.stringify({ title: "Plan" }),
	"canvases/plan/files/a.txt": "hello",
	"canvases/other/canvas.pen": JSON.stringify({ version: "2.14", children: [] }),
	"canvases/other/files/b.txt": "secret",
};

test("the built page is public, and says how to build it when it is not", async () => {
	const dist = mkdtempSync(join(tmpdir(), "frame-"));
	const server = await testServer({ features: [frameFeature({ dist })] });
	const doors = await server.listen(0);
	assert.equal((await fetch(`${doors.url}/canvas-frame.html`)).status, 503);
	writeFileSync(join(dist, "canvas-frame.html"), "<p>frame</p>");
	const page = await fetch(`${doors.url}/canvas-frame.html`, { headers: { origin: "null" } });
	assert.equal(await page.text(), "<p>frame</p>");
	assert.equal((await fetch(`${doors.url}/frame-assets/../../package.json`)).status, 404);
	await doors.close();
	await server.close();
});

test("a pass opens its canvas's files, and nothing else", async () => {
	const server = await testServer({ features: [canvasFeature(), cards(), frameFeature()], deck });
	const doors = await server.listen(0);
	const ask = (token: string) => fetch(`${doors.url}/api/passes`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ canvas: "Plan" }) });
	const got = (await (await ask(doors.token)).json()) as { pass: string; expires: number };
	assert.ok(got.pass && got.expires > Date.now());
	assert.equal((await ask(got.pass)).status, 403, "a pass cannot ask for a pass");
	const file = (path: string) => fetch(`${doors.url}/api/t/${got.pass}/card/${path}`);
	assert.equal(await (await file("canvases/plan/files/a.txt")).text(), "hello");
	assert.equal((await file("canvases/other/files/b.txt")).status, 404);
	assert.equal((await fetch(`${doors.url}/api/t/dk_nothing/card/canvases/plan/files/a.txt`)).status, 404);
	await doors.close();
	await server.close();
});
