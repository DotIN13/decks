/**
 * A canvas frame hears its canvas from the start, even when the canvas is empty.
 *
 * The frame's line to the harness opened only at the frame's first message (a card seen, a card's
 * size), so a frame on a canvas with nothing on it never opened one, and what an agent put there
 * showed only after a reload. Here an agent makes a new canvas, makes it its home, moves the person's
 * screen to it and inserts a note and a document: both must show in the frame without a reload.
 */
import { API, asPerson, canvasFrame, open, rest, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = await test(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 150)); } };
const { browser, page, errors } = await open({ width: 1400, height: 900 });
await rest(page, { start: 300 });
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person, "x-decks-agent": agentId }, body: JSON.stringify({ args }) })).json();

const made = await call("canvas.create", ["Empty canvas"]);
const name = made.value?.name;
say("the agent made a canvas", made.ok && !!name, JSON.stringify(made).slice(0, 160));
const home = await call("agent.update", [{ canvas: name }]);
say("the agent made it its home", home.ok, JSON.stringify(home).slice(0, 160));
const went = await call("view.goto", [name]);
say("the person's screen is on it", went.ok && went.value?.moved !== false, JSON.stringify(went).slice(0, 160));
await settle(page, 1500);
const canvas = await canvasFrame(page);
const onIt = await until(() => canvas.evaluate((name) => String(globalThis.__decksRust?.base ?? "").includes(`/canvases/${name}/`), name), 8000);
say("the frame on screen is the new, empty canvas", onIt, String(await canvas.evaluate(() => globalThis.__decksRust?.base).catch(() => "")));

const note = await call("canvas.insert", [{ type: "note", id: "ecf-note", content: "Hello from the agent" }, { canvas: name, at: { x1: 100, y1: 100 } }]);
say("the agent inserted a note", note.ok, JSON.stringify(note).slice(0, 160));
const seen = await until(() => canvas.evaluate(() => !!globalThis.__decksRust?.placed?.has("ecf-note")).catch(() => false), 6000);
say("the note shows in the frame without a reload", seen, seen ? "seen" : "not seen in 6 s");

const doc = await call("canvas.insert", [{ type: "browser", id: "ecf-doc", width: 600, height: 400, metadata: { type: "decks.document", path: `canvases/${name}/files/notes.md` } }, { canvas: name, at: { x1: 800, y1: 100 } }]);
say("the agent inserted a document item", doc.ok, JSON.stringify(doc).slice(0, 160));
const seen2 = await until(() => canvas.evaluate(() => !!globalThis.__decksRust?.placed?.has("ecf-doc")).catch(() => false), 6000);
say("the document shows in the frame without a reload", seen2, seen2 ? "seen" : "not seen in 6 s");

say("no errors on the page", errors.length === 0, errors.join(" | ").slice(0, 300));
link.close?.();
await browser.close();
setTimeout(() => process.exit(0), 500).unref();
