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
};

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
			body = encoding === "br" ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }) : gzipSync(raw, { level: 9 });
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
