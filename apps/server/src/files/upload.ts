import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_UPLOAD_BYTES, type UploadedAsset } from "@decks/protocol";
import { resolveAssetWrite } from "../deck/roots.ts";

/**
 * A file the user dragged in from outside, copied into the deck (DESIGN §3).
 *
 * This is the first thing in Decks that writes bytes somewhere the user did not
 * name, so the shape is deliberately narrow: one file per request, one directory
 * it can land in (`assets/`, which already means "the files the boards use"), and
 * a name that is *derived* from what the browser said rather than taken from it.
 * The path decision itself is `resolveAssetWrite` in `deck/roots.ts`, because that
 * is where every path decision lives; what is here is the naming and the choice
 * of what to do when the name is taken.
 *
 * **Names stay readable, and nothing is ever overwritten.** The alternative —
 * naming the file after the hash of its contents — was rejected: `assets/` is a
 * directory a person opens and an agent greps, and `data-embed="../assets/
 * 9f3c…d1.png"` tells neither of them anything. So the hash is used for
 * *comparison* instead: the same file dropped twice reuses the copy that is
 * already there, and a different file with the same name becomes `photo-2.png`.
 * That makes an upload idempotent without making the deck unreadable.
 */

export class UploadRefused extends Error {
	constructor(
		reason: string,
		readonly status: number = 400,
	) {
		super(reason);
		this.name = "UploadRefused";
	}
}

/**
 * What the browser called the file -> a plain file name we are willing to create.
 *
 * Everything a file name can carry that a path should not is removed rather than
 * escaped: directory separators (both kinds — the client may be a Windows
 * browser), `..`, control characters and NUL, and leading dots, so no upload can
 * become a dotfile and none can address `.decks/` or a sibling of `assets/`.
 *
 * The alphabet is ASCII, which is a real trade: `документ.png` arrives as
 * `file.png`. Transliterating properly means Unicode normalisation, and the same
 * name in NFC and NFD is two files on Linux and one on macOS — a difference that
 * would decide whether the de-duplication below fires. A boring name is a better
 * bargain than a subtle one.
 *
 * Percent-encoding is deliberately not decoded: a name arriving as `%2e%2e%2f` is
 * a name with those characters in it, and decoding it would hand back the
 * traversal the split has just removed.
 */
export function assetName(requested: string): string {
	const base = String(requested ?? "").split(/[/\\]/).pop() ?? "";
	const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-{2,}/g, "-");

	const dot = cleaned.lastIndexOf(".");
	let stem = dot > 0 ? cleaned.slice(0, dot) : cleaned;
	let extension = dot > 0 ? cleaned.slice(dot + 1) : "";
	// An "extension" that is not a short run of letters and digits is part of the
	// name, not a type: `notes.tar.gz-old` should not be filed as a `.gz-old`.
	if (extension.length > 12 || !/^[A-Za-z0-9]+$/.test(extension)) {
		stem = cleaned;
		extension = "";
	}
	/*
	 * The stem is trimmed *after* the extension has been taken off, which is the
	 * order that keeps `документ.png` a `.png`. Trimming the whole name first turned
	 * it into `-.png` and then into `png` — a file whose type had moved into its
	 * name, so the board sniffed it as having no extension at all.
	 *
	 * Leading dots and dashes both go: the first would make a dotfile, the second
	 * only looks like one of this function's own repairs. The length cap leaves room
	 * for a `-17` and the extension inside every filesystem's limit.
	 */
	stem = stem.slice(0, 80).replace(/^[.\-]+/, "").replace(/[.\-]+$/, "");
	if (stem.length === 0) stem = "file";
	return extension ? `${stem}.${extension.toLowerCase()}` : stem;
}

/**
 * Refuse an upload that some other page in the browser started.
 *
 * `Sec-Fetch-Site` is set by the browser and cannot be written by page script, so
 * this is the one CSRF check that costs nothing: the only legitimate caller is the
 * app's own `fetch`, which arrives as `same-origin`. An absent header is allowed —
 * `curl` and older Safari do not send it, and the threat here is a browser being
 * pointed at loopback, not a shell.
 *
 * It does not make the app safe, and it is worth being clear about why: `/ws` next
 * door accepts every frame from every origin and runs tool calls, and WebSockets
 * are not subject to CORS, so a hostile page already has more than this route
 * offers (DEPLOYMENT §1). What the check buys is that the *newest* way to write
 * bytes into the deck is not also the easiest one to reach by accident.
 */
export function refuseCrossSite(fetchSite: string | undefined): void {
	if (fetchSite === undefined || fetchSite === "same-origin" || fetchSite === "none") return;
	throw new UploadRefused(`an upload from ${fetchSite} is not this app's own`, 403);
}

/** `photo.png`, 2 -> `photo-2.png`. The suffix goes on the name, not the type. */
function suffixed(name: string, n: number): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
}

const digestOf = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/**
 * Write a dropped file into the deck's `assets/`, and say where it went.
 *
 * The returned path is deck-relative with forward slashes, the same currency the
 * rest of the app deals in, because the caller's next move is to put it in a
 * board's `data-embed`.
 */
export function storeAsset(deckRoot: string, requested: string, bytes: Buffer): UploadedAsset {
	if (bytes.length === 0) throw new UploadRefused("that file is empty");
	if (bytes.length > MAX_UPLOAD_BYTES) {
		throw new UploadRefused(`that file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`, 413);
	}

	const name = assetName(requested);
	mkdirSync(join(deckRoot, "assets"), { recursive: true });
	const digest = digestOf(bytes);

	// A bounded search rather than a loop that cannot end: ninety-nine files called
	// the same thing is a bug or a script, and either deserves an answer.
	for (let n = 1; n <= 99; n++) {
		const candidate = n === 1 ? name : suffixed(name, n);
		const target = resolveAssetWrite(deckRoot, candidate);
		const relative = `assets/${candidate}`;

		if (existsSync(target)) {
			// Byte-identical: hand back what is already there. Dropping the same
			// screenshot onto two boards should not leave two copies of it.
			if (digestOf(readFileSync(target)) === digest) {
				return { path: relative, name: candidate, bytes: bytes.length, reused: true };
			}
			continue;
		}

		try {
			// `wx` and not a plain write: O_EXCL is what makes "never overwrite" true
			// against the gap between the check above and this line, and it refuses to
			// follow a symlink that appeared in it.
			writeFileSync(target, bytes, { flag: "wx" });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") continue; // lost the race; try the next name
			throw error;
		}
		return { path: relative, name: candidate, bytes: bytes.length, reused: false };
	}

	throw new UploadRefused(`there are already too many files called ${name}`, 409);
}
