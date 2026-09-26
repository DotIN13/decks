/**
 * Where a board lands does not depend on who is looking: the stage decides, not a camera.
 *
 * The bug this pins down came back twice. A new board was put at the middle of a camera, and the
 * camera the server had was the wrong one: first another canvas's, then whichever browser window
 * had panned last, on any agent's stage. Boards landed tens of thousands of pixels from their own.
 * So this sets up the worst case by hand: a second window on another agent, panned far away; this
 * window panned far away too; and a note drawn in the slot a board would take first. Then the ＋.
 * The board has to land beside the stage's newest board, off the note, and the camera go to it.
 *
 * `placement.mjs` is the ordinary case; `deck/place.ts` is the rule.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { deckState, newAgent, open, say, settle, socket, WEB } from "../harness.mjs";

const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } };
const deck = await deckState();
const link = await socket();
const agentA = await until(() => link.last("agents")?.focused);
const stageName = await until(() => link.last("stages")?.stages.find((row) => row.agents.some((agent) => agent.id === agentA))?.name);
const file = stageName ? join(deck.path, "stages", stageName, "stage.pen") : "";
const doc = () => JSON.parse(readFileSync(file, "utf8"));
const boards = () => doc().children.filter((n) => n.type === "browser").map((n) => ({ path: n.metadata.path, x: n.x, y: n.y, w: n.width, h: n.height }));
say("agent A's stage file", existsSync(file), file);

const { browser, page, errors } = await open({ width: 1500, height: 1000 });
await settle(page, 1500);
const newest = boards().at(-1);
say("A's stage has a newest board", !!newest, JSON.stringify(newest));

// A note drawn by hand in the first-choice slot: right of the newest board, top edges level.
const slot = { x: newest.x + newest.w + 160 + 20, y: newest.y + 20 };
const toScreen = () => page.evaluate(({ x, y }) => { const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform); return { x: x * m.a + m.e, y: y * m.a + m.f }; }, slot);
const first = await toScreen();
await page.mouse.move(800, 500);
await page.mouse.wheel(first.x - 800, first.y - 500);
await settle(page, 600);
const screen = await page.evaluate(({ x, y }) => { const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform); return { x: x * m.a + m.e, y: y * m.a + m.f, zoom: m.a }; }, slot);
const onPage = screen.x > 300 && screen.x < 1450 && screen.y > 120 && screen.y < 950;
say("the first-choice slot is on screen to draw in", onPage, JSON.stringify(screen));
const hadIds = new Set(doc().children.map((n) => n.id));
await page.mouse.click(screen.x, screen.y);
await page.keyboard.press("Escape");
await page.keyboard.press("c");
await page.mouse.click(screen.x, screen.y);
await settle(page, 600);
await page.keyboard.type("In the way");
await settle(page, 300);
await page.mouse.click(1100, 250);
await settle(page, 1500);
const note = await until(() => doc().children.find((n) => !hadIds.has(n.id) && n.type === "note"));
say("a note drawn by hand sits in that slot", !!note, JSON.stringify(note && { x: note.x, y: note.y, w: note.width, h: note.height }));

// Another window, on another agent, panned far away: the view that used to decide.
const other = await chromium.launch();
const pageB = await (await other.newContext({ viewport: { width: 1378, height: 702 } })).newPage();
const reportsB = [];
pageB.on("websocket", (ws) => ws.on("framesent", (f) => { try { const m = JSON.parse(f.payload); if (m.type === "camera.set") reportsB.push(m.agentId); } catch {} }));
await pageB.goto(WEB, { waitUntil: "networkidle" });
await settle(pageB, 1500);
await newAgent(pageB, "pi");
await settle(pageB, 1200);
await pageB.mouse.move(700, 400);
for (let i = 0; i < 25; i++) await pageB.mouse.wheel(0, 4000);
await settle(pageB, 800);
const agentB = reportsB.at(-1);
say("a second window is on another agent", !!agentB && agentB !== agentA, `${agentA} / ${agentB}`);

// A's own view panned far away too.
await page.mouse.move(800, 500);
for (let i = 0; i < 25; i++) await page.mouse.wheel(3000, 3000);
await settle(page, 800);
const camA = await page.evaluate(() => { const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform); return { x: (750 - m.e) / m.a, y: (500 - m.f) / m.a }; });
say("A's own view is far from its boards", Math.hypot(camA.x - newest.x, camA.y - newest.y) > 20000, JSON.stringify(camA));

say("the note is still there when the ＋ is pressed", doc().children.some((n) => n.id === note?.id));
// The ＋, pressed in A's window.
const before = new Set(boards().map((b) => b.path));
await page.locator('button[aria-label="A new board, on the canvas"]').click();
await settle(page, 300);
await page.locator(".popover [data-row]").first().click();
const made = await until(() => boards().find((b) => !before.has(b.path)), 10000);
const n = note && { x: note.x, y: note.y, w: note.width ?? 240, h: note.height ?? 120 };
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const gap = made && Math.max(Math.max(newest.x - (made.x + made.w), made.x - (newest.x + newest.w)), Math.max(newest.y - (made.y + made.h), made.y - (newest.y + newest.h)));
say("the ＋ made a board on A's stage", !!made, JSON.stringify(made));
say("…beside the newest board, closer than half a board width", made && gap < 500, `gap ${gap} px`);
say("…not on the note drawn in the slot", made && n && !hit(made, n), JSON.stringify(n));
say("…and not where either window was looking", made && Math.hypot(made.x - camA.x, made.y - camA.y) > 15000);
say("…on no other board", made && boards().filter((b) => b.path !== made.path).every((b) => !hit(made, b)));
await settle(page, 1500);
const shown = await page.evaluate((p) => { const r = document.querySelector(`.board-node[data-path="${p}"]`)?.getBoundingClientRect(); return r && r.right > 0 && r.x < innerWidth && r.bottom > 0 && r.y < innerHeight; }, made?.path);
say("…and A's camera went to it", shown === true);
say("no page errors", errors.length === 0, errors.join("; "));
link.close();
await other.close();
await browser.close();
