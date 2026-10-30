/**
 * What the person and an agent put on the canvas is never a board any more.
 *
 * - A PDF dropped on empty canvas is a file card, as any other dropped file is (`files.ts`,
 *   `placeFileCards`): a picture of its first page with its name, and no board in `boards/files/`.
 * - A document from the file picker is a document item (`document.create`), `{ type: "browser",
 *   metadata: { type: "decks.document", path } }`, where it was asked for, answered with its path on
 *   the stage (`item:<id>`), and no board in `boards/documents/`.
 * - An app made with `apps create` answers with the item that shows it, `{ type: "app", app }`, and
 *   `canvas insert` places it as a `decks.app` item; no board in `boards/apps/`.
 *
 * A double-click on empty canvas makes a note, which `stage-gestures` and `edits-wait` check.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { API, asPerson, canvasFrame, deckState, open, resetStage, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 10000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();

const { browser, page, errors } = await open({ width: 1500, height: 1000 });
await resetStage(page);
await settle(page, 900);
const link = await socket();
const deck = await deckState();
const agentId = await until(() => link.last("agents")?.focused);
const stageName = await until(() => link.last("stages")?.stages.find((row) => row.agents.some((agent) => agent.id === agentId))?.name);
const file = join(deck.path, "canvases", stageName ?? "?", "canvas.pen");
const items = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).children ?? [] : []);
const tagged = (type) => items().filter((node) => node.type === "browser" && node.metadata?.type === type);
const boardsBefore = tagged("decks.board").length;
const onStage = async (path) => (await canvasFrame(page)).evaluate((wanted) => (window.__decksBoards?.() ?? []).some((one) => one.path === wanted), path);

// --- a PDF dropped on empty canvas ---------------------------------------------------------

const canvas = await canvasFrame(page);
/* A point of the frame with no board or card under it: a drop over a card goes into the card. */
const empty = await canvas.evaluate(() => {
	const rects = (window.__decksBoards?.() ?? []).map((one) => one.rect);
	for (let y = 120; y < window.innerHeight - 120; y += 60)
		for (let x = 120; x < window.innerWidth - 120; x += 60)
			if (!rects.some((r) => x > r.x - 40 && x < r.right + 40 && y > r.y - 40 && y < r.bottom + 40) && !globalThis.__decksCardAt?.(x, y)) return { x, y };
	return { x: 60, y: window.innerHeight - 60 };
});
await canvas.evaluate(({ x, y }) => {
	const data = new DataTransfer();
	data.items.add(new File(["%PDF-1.4 a paper"], "e2e-paper.pdf", { type: "application/pdf" }));
	const target = document.elementFromPoint(x, y) ?? document.body;
	for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: data }));
}, empty);
const card = await until(() => items().find((node) => node.metadata?.type === "decks.file" && /e2e-paper\.pdf$/.test(String(node.metadata.path))), 15000);
say("a PDF dropped on empty canvas is a file card", !!card, JSON.stringify(items().map((n) => n.metadata?.type ?? n.type)));
say("…and no board is made for it", tagged("decks.board").length === boardsBefore && !existsSync(join(deck.path, "boards", "files")), `${boardsBefore} -> ${tagged("decks.board").length}`);

// --- a document from the picker, at a point -------------------------------------------------

link.send({ type: "document.create", document: "docs/notes.md", at: { x: 40000, y: 30000 }, request: "items-1" });
const answered = await until(() => link.received.find((m) => m.type === "document.created" && m.request === "items-1"));
say("a document from the picker is answered with its item's path", /^item:/.test(answered?.path ?? ""), JSON.stringify(answered));
const doc = tagged("decks.document").find((node) => `item:${node.id}` === answered?.path);
say("…a document item naming the file, where it was asked for", doc?.metadata?.path === "docs/notes.md" && doc.x === 40000 && doc.y === 30000, JSON.stringify(doc));
say("…drawn on the stage", !!(await until(() => (answered ? onStage(answered.path) : false))));
say("…and no board is made for it", !existsSync(join(deck.path, "boards", "documents")));
link.send({ type: "document.create", document: "docs/no-such-file.md", request: "items-2" });
const refused = await until(() => link.received.find((m) => m.type === "notice" && /no-such-file/.test(m.text)));
say("a file that is not there is refused in a sentence", !!refused && !link.received.some((m) => m.request === "items-2"), JSON.stringify(refused));

// --- an app, made and placed ------------------------------------------------------------------

const made = await call("apps.create", ["e2e-notes", { title: "E2E notes" }]);
say("apps create answers with the item that shows the app", made.ok && made.value?.item?.type === "app" && made.value.item.app === "e2e-notes" && made.value.board === undefined, JSON.stringify(made.value ?? made.error));
say("…its next step places it with canvas insert", /canvas insert '\{"type":"app","app":"e2e-notes"\}'/.test(made.value?.next ?? ""), made.value?.next);
const placed = await call("canvas.insert", [made.value?.item, { canvas: stageName, at: { x1: 46000, y1: 30000 } }]);
say("canvas insert places it as an app item", placed.ok && placed.value?.metadata?.type === "decks.app" && placed.value.metadata.name === "e2e-notes" && placed.value.name === "E2E notes", JSON.stringify(placed.value ?? placed.error));
say("…drawn on the stage", !!(await until(() => (placed.value?.id ? onStage(`item:${placed.value.id}`) : false))));
say("…and no board is made for it", !existsSync(join(deck.path, "boards", "apps")));

say("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
link.close();
await browser.close();
