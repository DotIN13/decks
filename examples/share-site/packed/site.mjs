// Run by scripts/test-packages.mjs in a folder holding only the packed @decks packages.
// A canvas-sharing site from the published packages alone, run by plain Node: no tsx, no decks checkout.
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { serialize, parse } from "@decks/pen";
import { Live, MemoryStore, syncHandler } from "@decks/hub";
import { nodeHandler } from "@decks/hub/node";
import { HarnessSync } from "@decks/sync-client";
import { libFile, LIVE_CARD_HEADERS } from "@decks/card-host";

const store = new MemoryStore();
const live = new Live(store);
const keys = new Map([["key-a", { user: { id: "ada", name: "Ada" }, harness: { id: "mini", name: "Mac mini" } }], ["key-b", { user: { id: "ada", name: "Ada" }, harness: { id: "laptop", name: "Laptop" } }]]);
const who = (req) => keys.get(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
const sync = nodeHandler(syncHandler({ store, live, who }));
const server = createServer(async (req, res) => {
	if (await sync(req, res)) return;
	if (req.url.startsWith("/lib/")) { const f = libFile(req.url.slice(5)); if (f) { res.writeHead(200, { ...LIVE_CARD_HEADERS, "Content-Type": f.type }); return res.end(f.bytes); } }
	res.writeHead(404).end();
});
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => { const w = keys.get(String(req.headers.authorization ?? "").replace(/^Bearer /, "")); if (!w) return socket.destroy(); wss.handleUpgrade(req, socket, head, (ws) => live.add(ws, w)); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;

const root = mkdtempSync(join(tmpdir(), "site-"));
const deck = (n) => { const d = join(root, n); mkdirSync(join(d, "canvases", "plan", "boards"), { recursive: true }); return d; };
const a = deck("mini"), b = deck("laptop");
writeFileSync(join(a, "canvases", "plan", "canvas.pen"), serialize({ version: "2.14", children: [{ id: "n1", type: "note", content: "made on the mini", x: 0, y: 0 }] }));
writeFileSync(join(a, "canvases", "plan", "boards", "plan.html"), "<h1>Plan</h1>");
const sa = new HarnessSync({ deck: a, studio: url, key: "key-a", log: () => {} });
const sb = new HarnessSync({ deck: b, studio: url, key: "key-b", log: () => {} });
await sa.sync(); await sb.sync();
const got = parse(readFileSync(join(b, "canvases", "plan", "canvas.pen"), "utf8"));
const board = readFileSync(join(b, "canvases", "plan", "boards", "plan.html"), "utf8");
const css = await fetch(url + "/lib/card.css");
console.log(JSON.stringify({ node: process.version, laptopHas: got.children[0].content, board, boardCss: [css.status, css.headers.get("content-type")], canvases: store.canvases("ada").length }));
server.closeAllConnections(); server.close(); process.exit(0);
