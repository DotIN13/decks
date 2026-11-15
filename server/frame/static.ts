import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { Route, RouteAnswer } from "../kernel/index.ts";

// The built canvas page, public (README rules 1 and 4): /canvas-frame.html and /frame-assets/.
// The only files this feature reads from the disk are its own build output.

export const DIST = new URL("./dist/", import.meta.url).pathname;
const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
	".json": "application/json", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".woff2": "font/woff2", ".png": "image/png",
};
const NOT_BUILT = "The canvas page is not built. Run: node tools/heavy.mjs --wait -- node server/frame/build.mjs";

async function fileAnswer(dist: string, rel: string): Promise<RouteAnswer> {
	const root = normalize(dist).replace(/[\\/]+$/, "");
	const file = normalize(join(root, rel));
	if (!file.startsWith(root + sep)) return { status: 404, type: "text/plain", body: "Not found." };
	try {
		const body = await readFile(file);
		const cache = rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache";
		return { type: TYPES[extname(file)] ?? "application/octet-stream", body, headers: { "cache-control": cache } };
	} catch {
		return rel === "canvas-frame.html" ? { status: 503, type: "text/plain", body: NOT_BUILT } : { status: 404, type: "text/plain", body: "Not found." };
	}
}

export function staticRoutes(dist = DIST): Route[] {
	return [
		{ method: "GET", prefix: "/canvas-frame.html", public: true, answer: async () => fileAnswer(dist, "canvas-frame.html") },
		{ method: "GET", prefix: "/frame-assets/", public: true, answer: async (_ctx, path) => fileAnswer(dist, decodeURIComponent(path).slice("/frame-assets/".length)) },
	];
}
