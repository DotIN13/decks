import type { Page } from "../state/types/index.ts";
import type { PenDocument } from "@decks/pen";
import { api, connections, newId, saveConnections, type Connection } from "./connection.ts";
import { readZip } from "./zip.ts";

/**
 * A canvas opened from a `.decks` file, and the backend that serves it from this tab.
 *
 * Opening one unpacks it into the browser's Cache Storage under `/c/<id>/`, where the service worker
 * finds its files (`public/sw.js`). Reading it as a canvas waits for a backend on the new line:
 * the old socket stand-in went with the old socket.
 *
 * A bundle has no agents, but the app draws a stage as somebody's: the drawing and the boards on
 * screen are an agent's (`state/pens.ts`). So the backend names one reader, `READER`, with the
 * canvas's title, and says in its greeting that it can neither run agents nor write, which is what
 * keeps the composer and the editing tools off the screen (`BackendInfo`).
 */
export interface BundleManifest {
	decks: number;
	made: string;
	from: string;
	stage: { name: string; title: string; rev: number };
	pen: { doc: PenDocument; base: string };
	boards: Page[];
	pictures: Record<string, { light?: string; dark?: string }>;
}

const READER = "reader";

function cacheName(id: string): string {
	return `decks-bundle-${id}`;
}

const TYPES: Record<string, string> = {
	html: "text/html; charset=utf-8",
	htm: "text/html; charset=utf-8",
	css: "text/css; charset=utf-8",
	js: "text/javascript; charset=utf-8",
	mjs: "text/javascript; charset=utf-8",
	json: "application/json",
	pen: "application/json",
	md: "text/markdown; charset=utf-8",
	txt: "text/plain; charset=utf-8",
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	ico: "image/x-icon",
	woff: "font/woff",
	woff2: "font/woff2",
	ttf: "font/ttf",
	otf: "font/otf",
	pdf: "application/pdf",
	wasm: "application/wasm",
	mp4: "video/mp4",
	webm: "video/webm",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	csv: "text/csv; charset=utf-8",
};

export function typeOf(name: string): string {
	const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
	return TYPES[ext] ?? "application/octet-stream";
}

/** Unpack a `.decks` file into this browser and add it to the connections; answers its id. */
export async function openBundle(file: Blob): Promise<string> {
	const files = readZip(await file.arrayBuffer());
	const manifestFile = files.find((one) => one.name === "manifest.json");
	if (!manifestFile) throw new Error("This file has no manifest, so it is not a Decks canvas.");
	const manifest = JSON.parse(new TextDecoder().decode(await manifestFile.bytes())) as BundleManifest;
	if (manifest.decks !== 1) throw new Error(`This canvas was saved by a newer Decks (format ${manifest.decks}).`);
	const id = newId();
	const cache = await caches.open(cacheName(id));
	for (const one of files) {
		const bytes = await one.bytes();
		await cache.put(`/c/${id}/${one.name}`, new Response(bytes as BodyInit, { headers: { "Content-Type": typeOf(one.name) } }));
	}
	const entry: Connection = { id, kind: "bundle", label: manifest.stage.title, from: manifest.from, added: Date.now(), boards: manifest.boards.length };
	saveConnections([...connections(), entry]);
	return id;
}

/** Forget a bundle: its files and its row. A server's row goes the same way, without a cache. */
export async function forget(id: string): Promise<void> {
	await caches.delete(cacheName(id)).catch(() => false);
	saveConnections(connections().filter((one) => one.id !== id));
}

async function manifestOf(id: string): Promise<BundleManifest> {
	const cache = await caches.open(cacheName(id));
	const response = await cache.match(`/c/${id}/manifest.json`);
	if (!response) throw new Error("This canvas's files are gone from this browser. Open the .decks file again.");
	return (await response.json()) as BundleManifest;
}
