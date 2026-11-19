import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import type { NextFunction, Request, Response } from "express";

/**
 * The built UI, compressed and cached the way its file names allow.
 *
 * `express.static` sends every file as it is on disk and tells the browser to check back
 * each time. For the files Vite names by their contents — everything under `/assets/` —
 * checking back can never find a change, so they are cached for a year and marked
 * immutable; `index.html` is the one file that says which of them to load, so it is always
 * revalidated and a deploy is picked up on the next open. And text is sent compressed:
 * the main bundle is 280 KB as built and a third of that gzipped.
 *
 * Compressed once per file and kept, keyed on size and mtime, so a rebuild in place is
 * noticed and nothing is compressed twice. Anything not handled here — an image, a client
 * that asks for no encoding — falls through to `express.static`, which gets the same cache
 * headers from `cacheControlFor`.
 *
 * The same squeeze serves what the canvas's frames load beyond the built UI: a card's own text
 * files (`squeezedFile`, from `routes/shared.ts`) and a drawing as JSON (`sendSqueezedJson`). A
 * sandboxed frame has no cache in the browser, so each of these is fetched whole every time a
 * frame starts, and from another device every byte is time: the drawing engine's module is 4 MB
 * as built and 1.1 MB squeezed, a large canvas's drawing 865 KB and under 200.
 */

const TYPES: Record<string, string> = {
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".svg": "image/svg+xml",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".webmanifest": "application/manifest+json",
	// The drawing engine's module: named for streaming compilation, which asks for exactly this type.
	".wasm": "application/wasm",
	// The font files the app ships (`apps/web/public/fonts`): a third smaller squeezed.
	".ttf": "font/ttf",
	".md": "text/markdown; charset=utf-8",
	".tex": "text/plain; charset=utf-8",
};

/** How hard brotli works: all it has on a small file, less on a large one, where it would hold the server's one thread for seconds. */
const qualityFor = (bytes: number): number => (bytes > 1_000_000 ? 6 : 9);

/** A buffer squeezed for an encoding. `fast` for what is squeezed while a request waits and may never be asked for again. */
export function squeeze(raw: Buffer, encoding: "br" | "gzip", fast = false): Buffer {
	if (encoding === "gzip") return gzipSync(raw, { level: fast ? 6 : 9 });
	return brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: fast ? 4 : qualityFor(raw.length), [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
}

/** A year for a file named by its hash; revalidate everything else. */
export function cacheControlFor(path: string): string {
	return path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
}

/** The encoding to answer with: brotli if the browser takes it, then gzip, else none. */
export function pickEncoding(accept: string | undefined): "br" | "gzip" | undefined {
	if (!accept) return undefined;
	const offered = new Map<string, number>();
	for (const part of accept.split(",")) {
		const [name, ...params] = part.trim().toLowerCase().split(";");
		if (!name) continue;
		const q = params.map((param) => /^\s*q=([\d.]+)\s*$/.exec(param)?.[1]).find(Boolean);
		offered.set(name, q === undefined ? 1 : Number(q));
	}
	const accepted = (name: string) => (offered.get(name) ?? offered.get("*") ?? 0) > 0;
	if (accepted("br")) return "br";
	if (accepted("gzip")) return "gzip";
	return undefined;
}

interface Kept {
	size: number;
	mtime: number;
	br?: Buffer;
	gzip?: Buffer;
}

export function compressedStatic(root: string) {
	const kept = new Map<string, Kept>();
	const base = normalize(root);
	return (req: Request, res: Response, next: NextFunction): void => {
		if (req.method !== "GET" && req.method !== "HEAD") return next();
		let path: string;
		try {
			path = decodeURIComponent(req.path);
		} catch {
			return next();
		}
		if (path.endsWith("/")) path += "index.html";
		const type = TYPES[extname(path).toLowerCase()];
		const encoding = pickEncoding(req.headers["accept-encoding"]);
		if (!type || !encoding) return next();
		const file = normalize(join(base, path));
		if (!file.startsWith(base + sep)) return next();
		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(file);
		} catch {
			return next();
		}
		if (!stat.isFile()) return next();

		let entry = kept.get(file);
		if (!entry || entry.size !== stat.size || entry.mtime !== stat.mtimeMs) {
			entry = { size: stat.size, mtime: stat.mtimeMs };
			kept.set(file, entry);
		}
		let body = entry[encoding];
		if (!body) {
			const raw = readFileSync(file);
			body = squeeze(raw, encoding);
			entry[encoding] = body;
		}

		const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}-${encoding}"`;
		res.setHeader("Vary", "Accept-Encoding");
		res.setHeader("Cache-Control", cacheControlFor(path));
		res.setHeader("ETag", etag);
		if (req.headers["if-none-match"] === etag) {
			res.status(304).end();
			return;
		}
		res.setHeader("Content-Type", type);
		res.setHeader("Content-Encoding", encoding);
		res.setHeader("Content-Length", String(body.length));
		if (req.method === "HEAD") {
			res.end();
			return;
		}
		res.end(body);
	};
}

/** The least a body is before squeezing it is worth the work: under this the headers weigh as much. */
const WORTH = 1024;

/**
 * A deck's own text file, squeezed for a browser that takes it: a card's page, its stylesheet, its
 * module, its data. Kept by path, size and mtime, the copies together held under a ceiling, the
 * oldest let go first. Answers nothing for a file that is no text (a picture, a font, which are
 * squeezed already), is small, or is asked for in part.
 */
const keptFiles = new Map<string, { key: string; encoding: "br" | "gzip"; body: Buffer }>();
let keptBytes = 0;
const KEPT_MOST = 48 * 1024 * 1024;

export function squeezedFile(file: string, accept: string | undefined, range: string | undefined): { body: Buffer; encoding: "br" | "gzip"; type: string; etag: string } | undefined {
	const type = TYPES[extname(file).toLowerCase()];
	const encoding = pickEncoding(accept);
	if (!type || !encoding || range) return undefined;
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(file);
	} catch {
		return undefined;
	}
	if (!stat.isFile() || stat.size < WORTH) return undefined;
	const key = `${stat.size}-${stat.mtimeMs}`;
	const name = `${encoding}:${file}`;
	let entry = keptFiles.get(name);
	if (!entry || entry.key !== key) {
		if (entry) keptBytes -= entry.body.length;
		entry = { key, encoding, body: squeeze(readFileSync(file), encoding, true) };
		keptFiles.delete(name);
		keptFiles.set(name, entry);
		keptBytes += entry.body.length;
		for (const [old, one] of keptFiles) {
			if (keptBytes <= KEPT_MOST) break;
			keptFiles.delete(old);
			keptBytes -= one.body.length;
		}
	}
	return { body: entry.body, encoding, type, etag: `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}-${encoding}"` };
}

/** JSON, squeezed when the browser takes it and there is enough of it: a canvas's drawing, which a frame reads whole each time it starts. */
export function sendSqueezedJson(req: Request, res: Response, value: unknown): void {
	const raw = Buffer.from(JSON.stringify(value));
	const encoding = raw.length < WORTH ? undefined : pickEncoding(req.headers["accept-encoding"]);
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Vary", "Accept-Encoding");
	if (!encoding) return void res.end(raw);
	const body = squeeze(raw, encoding, true);
	res.setHeader("Content-Encoding", encoding);
	res.setHeader("Content-Length", String(body.length));
	res.end(body);
}
