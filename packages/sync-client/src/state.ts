import { chmodSync, existsSync, mkdirSync, readFileSync as readFileRaw, writeFileSync as writeFileRaw } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "@decks/pen";
import { canvasFolder, sharedParts } from "@decks/hub/layout";
import type { LiveEvent, SyncProgress } from "@decks/sync-protocol";
import type { Bases } from "./bases.ts";
import { HashCache } from "./hash-cache.ts";

/**
 * What a harness's sync is given, and what it remembers between runs: the options, the state in
 * `.decks/studio-sync.json`, and the disk reads and writes it counts for the bench. Every part of the
 * sync (`sync.ts` and the parts it is made of) shares these.
 */
export interface SyncOptions {
	deck: string;
	studio: string;
	key: string;
	log?: (line: string) => void;
	/**
	 * This harness's own address (`http://127.0.0.1:4329`), for a picture of each canvas: Studio
	 * shows it on the canvas's card. Absent: no canvas pictures, only cards'.
	 */
	harness?: string;
	/** A person token for this harness, read per call: what its screenshot call carries (`auth/guard.ts`). */
	harnessToken?: () => string;
	/**
	 * This harness's apps (`apps/service.ts`), told to Studio so it can list them beside the
	 * canvases. Absent: nothing is told.
	 */
	inventory?: () => Array<{ name: string; title: string; kind: string }>;
	/**
	 * A harness token for a Studio person's browser, when Studio asks for one over the live socket
	 * (`token.ask`): issued by the harness for that person, bound to Studio's origin, with when it lapses
	 * unused. It may throw, with a sentence Studio is told. Absent: every ask is refused.
	 */
	issueToken?: (ask: { user: { id: string; name: string }; origin: string }) => { token: string; expires: number };
	/**
	 * The key stopped being Studio's link: `revoked`, Studio closed the socket because the key was revoked
	 * there (the harness removed in Studio); `changed`, the harness's own key was removed or replaced
	 * (`apps/server/src/studio`). What was given through it should go.
	 */
	unlinked?: (why: "revoked" | "changed") => void;
	/**
	 * Where a drawing from Studio is written: through the harness's canvas store, which records the
	 * write as Studio's (`by`, Studio's user id or "studio"), so what came down is not sent up again
	 * (`edited`). Answers false to have the file written here instead. Absent: the file is written.
	 */
	remote?: { write(name: string, text: string, by: string): boolean };
	/**
	 * Someone elsewhere is on a canvas kept here: a person on a Studio page, or a person or an agent on
	 * another harness (`by.harness`). Said as Studio says it, by the canvas's name here.
	 */
	presence?: (name: string, event: Extract<LiveEvent, { type: "presence" }>) => void;
	/**
	 * How far the deck is in step with Studio, each time that changes (at most four times a second while
	 * files move, at once when the state does): for Settings, and for Studio (`SyncProgress`).
	 */
	progress?: (progress: SyncProgress) => void;
}

export interface CanvasState {
	id: string;
	rev: number;
	/** The drawing both sides last agreed on, kept here before 2026-10-21; now in `.decks/sync/<id>.pen`. */
	pen?: string;
	/** The canvas's files both sides last agreed on, by their path in the canvas's folder. */
	files: Record<string, { version: number; hash: string }>;
}

export interface State {
	studio: string;
	/** The Studio account this state belongs to: a key for another account starts afresh. */
	user?: string;
	/** By the canvas's name here: `plan`, or `shared/<owner>/<canvas>` for a friend's. */
	canvases: Record<string, CanvasState>;
	/** The folder each friend's canvases land in, by their account id: their name, made unique once. */
	owners?: Record<string, string>;
	/** The hash of the app list last told to Studio. */
	inventory?: string;
}

/**
 * What sync costs, counted for the bench (`DECKS_STUDIO_STATS`: a file each pass appends one JSON
 * line to): bytes read from disk, bytes hashed and how many files, bytes written, bytes Studio sent,
 * how many canvases a pass looked at, and the time spent taking canvas pictures (at most one a minute each).
 */
export const cost = { read: 0, hashed: 0, files: 0, written: 0, received: 0, canvases: 0, pictureMs: 0 };
export const readFileSync = ((...args: Parameters<typeof readFileRaw>) => {
	const out = readFileRaw(...args);
	cost.read += out.length;
	return out;
}) as typeof readFileRaw;
export const writeFileSync = ((file: Parameters<typeof writeFileRaw>[0], data: string | Uint8Array, options?: Parameters<typeof writeFileRaw>[2]) => {
	cost.written += typeof data === "string" ? Buffer.byteLength(data) : data.length;
	writeFileRaw(file, data, options);
}) as typeof writeFileRaw;

/** Files bigger than this are not synced, and are listed in `skipped`. */
export const MAX_BYTES = 50 * 1024 * 1024;

/** Whether a canvas's name here is a friend's, under shared/canvases/. */
export function isShared(name: string): boolean {
	return sharedParts(name) !== undefined;
}

/** A canvas's folder here, absolute. */
export function folderOf(deck: string, name: string): string {
	return join(deck, canvasFolder(name));
}

/**
 * The state in `.decks/studio-sync.json` and the hash cache beside it. `state` is replaced whole
 * when the key turns out to be another account's (`StudioTransport.hello`), so every part reads it
 * through here rather than keeping its own reference.
 */
export class SyncStore {
	state: State;
	readonly hashes: HashCache;
	private readonly file: string;
	/** The state as last written, so an unchanged one is not written again. */
	private written = "";

	constructor(deck: string, studio: string, bases: Bases) {
		this.file = join(deck, ".decks", "studio-sync.json");
		this.hashes = new HashCache(join(deck, ".decks", "studio-hashes.json"));
		let saved: State | undefined;
		try {
			saved = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as State) : undefined;
		} catch {
			saved = undefined;
		}
		this.state = saved && saved.studio === studio ? saved : { studio, canvases: {} };
		for (const one of Object.values(this.state.canvases)) {
			// A state from before canvases were bundles: each canvas's files are worked out again on the next pass.
			one.files ??= {};
			// A state from before the drawings had files of their own: each moves out to `.decks/sync/<id>.pen`.
			if (typeof one.pen === "string") {
				try {
					bases.keep(one.id, parse(one.pen), one.pen);
				} catch {
					/* unreadable: the next pass takes Studio's as the base */
				}
				delete one.pen;
			}
		}
		delete (this.state as { files?: unknown }).files;
	}

	/** The name here of the canvas Studio knows by this id, or undefined. */
	nameOf(id: string): string | undefined {
		return Object.entries(this.state.canvases).find(([, s]) => s.id === id)?.[0];
	}

	/** The state, only this account's to read, written when it changed: it holds revisions and file versions, no drawings. */
	save() {
		const text = JSON.stringify(this.state);
		if (text !== this.written) {
			mkdirSync(dirname(this.file), { recursive: true });
			writeFileSync(this.file, text, { mode: 0o600 });
			try {
				chmodSync(this.file, 0o600);
			} catch {
				/* a filesystem without modes */
			}
			this.written = text;
		}
		this.hashes.save();
	}
}
