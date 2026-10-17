// The demo's server: this folder, and a deck's folder under /deck/ (DECK, default ../../../data/decks).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const here = resolve(import.meta.dirname);
const deck = resolve(process.env.DECK ?? join(here, "../../../data/decks"));
const port = Number(process.env.PORT ?? 4791);
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".css": "text/css", ".json": "application/json", ".pen": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
	const url = new URL(req.url, "http://x");
	const path = decodeURIComponent(url.pathname);
	const [root, rest] = path.startsWith("/deck/") ? [deck, path.slice(6)] : [here, path.slice(1) || "index.html"];
	const file = normalize(join(root, rest));
	if (!file.startsWith(root)) return res.writeHead(403).end();
	try {
		const info = await stat(file);
		const body = await readFile(info.isDirectory() ? join(file, "index.html") : file);
		res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
	} catch {
		res.writeHead(404).end("not found");
	}
}).listen(port, () => console.log(`stage demo on http://localhost:${port}/?stage=herobrine (deck ${deck})`));
