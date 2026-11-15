#!/usr/bin/env node
// The built page for the checks: a plain static server with the dev server's proxy rules, so no
// check depends on a dev server. node tools/checks/page-server.mjs --dist <dir> --deck <deck> --port <n>
// It serves /page.json and the person's token in index.html (loopback), as harness/page's vite does.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { extname, join, normalize, sep } from "node:path";

/** Paths passed to Decks-local, as harness/page/vite.config.ts proxies them. */
export const PROXIED = ["/api", "/files/", "/mcp", "/compat/", "/ws", "/frame-assets/", "/frame/", "/app/", "/node/", "/rnode/"];
const TYPES = {
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
	".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm", ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".webmanifest": "application/manifest+json",
};

export const proxied = (path) => PROXIED.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`)));

/** The deck's server and its person token, from the lock file the server writes. */
export function lockOf(deck) {
	try {
		return JSON.parse(readFileSync(join(deck, ".decks/server.json"), "utf8"));
	} catch {
		return { url: "http://127.0.0.1:4620", token: "" };
	}
}

/** index.html with the person's token as the meta today's checks read, as the dev server gives it. */
export const withSession = (html, token) => html.replace(/<head([^>]*)>/i, `<head$1><meta name="decks-session" content="${token}">`);

function file(dist, path) {
	const root = normalize(dist).replace(/[\\/]+$/, "");
	const asked = normalize(join(root, decodeURIComponent(path)));
	if (!asked.startsWith(root + sep)) return undefined;
	if (existsSync(asked) && statSync(asked).isFile()) return asked;
	// A page address with no file of its own is the app, as the dev server answers it.
	return extname(asked) ? undefined : join(root, "index.html");
}

function serveFile(dist, lock, path, res) {
	const found = file(dist, path === "/" ? "/index.html" : path);
	if (!found) return void res.writeHead(404, { "content-type": "text/plain" }).end("Not found.");
	const headers = { "content-type": TYPES[extname(found)] ?? "application/octet-stream", "cache-control": "no-cache", "access-control-allow-origin": "*" };
	if (found.endsWith(`${sep}index.html`)) return void res.writeHead(200, headers).end(withSession(readFileSync(found, "utf8"), lock().token));
	res.writeHead(200, headers);
	createReadStream(found).pipe(res);
}

function proxy(target, req, res) {
	const url = new URL(target);
	const forwarded = { ...req.headers, "x-forwarded-for": req.socket.remoteAddress ?? "127.0.0.1" };
	const out = request({ host: url.hostname, port: url.port, method: req.method, path: req.url, headers: forwarded }, (answer) => {
		res.writeHead(answer.statusCode ?? 502, answer.headers);
		answer.pipe(res);
	});
	out.on("error", () => (res.headersSent ? res.destroy() : res.writeHead(502, { "content-type": "text/plain" }).end("Decks-local did not answer.")));
	req.pipe(out);
}

/** A WebSocket upgrade passed through as raw bytes, both ways; either side closing ends both. */
function tunnel(target, req, socket, head) {
	const url = new URL(target);
	const upstream = connect(Number(url.port), url.hostname, () => {
		const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`), "", ""];
		upstream.write(lines.join("\r\n"));
		if (head.length) upstream.write(head);
		upstream.pipe(socket);
		socket.pipe(upstream);
	});
	const end = () => (upstream.destroy(), socket.destroy());
	upstream.on("error", end);
	socket.on("error", end);
	upstream.on("close", end);
	socket.on("close", end);
}

export function startPageServer({ dist, deck, port, host = "127.0.0.1", compat = false }) {
	const lock = () => lockOf(deck);
	const server = createServer((req, res) => {
		const path = (req.url ?? "/").split("?")[0];
		if (path === "/page.json") return void res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ url: "", token: lock().token, ...(compat ? { compat: true } : {}) }));
		if (proxied(path)) return proxy(lock().url, req, res);
		serveFile(dist, lock, path, res);
	});
	server.on("upgrade", (req, socket, head) => tunnel(lock().url, req, socket, head));
	return new Promise((done) => server.listen(port, host, () => done(server)));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
	const arg = (flag) => process.argv[process.argv.indexOf(flag) + 1];
	await startPageServer({ dist: arg("--dist"), deck: arg("--deck"), port: Number(arg("--port")), compat: process.argv.includes("--compat") });
	console.log(`page on ${arg("--port")}`);
}
