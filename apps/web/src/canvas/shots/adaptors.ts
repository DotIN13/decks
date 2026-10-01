import type { Board } from "@decks/protocol";
import { createSignal } from "solid-js";
import { thumbUrl } from "../../lib/api.ts";
import { canvasPixelRatio, drawScale, elementContext } from "../picture.ts";
import { snapshotOf } from "./snapshot.ts";

/**
 * Where the picture of a board without a page comes from: one interface, three ways to take it.
 *
 * The stage's sheet draws every board that has no live page as a picture (`pen/scene.ts`). An
 * adaptor answers two questions: what URL is that picture at (`picture`), and, for an adaptor
 * that can, a picture of a page that is live right now, taken as it is let go (`capture`), so the
 * board keeps looking the way the reader left it. A board never opened here, or one a capture could
 * not take, always has the server's picture.
 *
 * - **`server`**: headless Chrome on the server (`boards/thumbs.ts`), the board loaded fresh from
 *   its file. Every board has one, opened or not, and pages from other sites draw.
 * - **`snapshot`**: the page's markup as it stands (`snapshot.ts`, a few ms), drawn by the server's
 *   Chrome at the board's own address (`boards/snapshot.ts`). A round trip, but real Chrome.
 * - **`canvas`**: Chrome's HTML-in-Canvas, drawing the live page straight into a canvas. Only with
 *   the Canvas renderer, where the page is a child of the board's own canvas, and only where the API
 *   is on (`chrome://flags/#canvas-draw-element`).
 *
 * They are tried in that order, canvas, snapshot, server, starting from the one chosen: `canvas`
 * falls back to a snapshot where Chrome cannot draw the page (the Documents renderer, or no flag),
 * `snapshot` to the server's picture, and an agent's screenshot (`seenPicture`) does the same.
 *
 * There was a fourth, modern-screenshot in this browser, copying every element's computed style onto
 * a clone and drawing it again as an SVG image. It stalled the page for up to two seconds a board,
 * since only the page's own thread can read its styles, and was taken out.
 */
export type ShotAdaptorId = "canvas" | "snapshot" | "server";

export interface ShotAdaptor {
	id: ShotAdaptorId;
	label: string;
	note: string;
	/** The picture the sheet draws for a board with no page: an address the scene can fetch. */
	picture(board: Pick<Board, "path" | "rev">, scheme: "light" | "dark"): string;
	/** A picture of a live page as it is now, kept until the board changes. Absent: this adaptor only has the server's. */
	capture?(frame: HTMLIFrameElement, board: Board): Promise<void>;
}

/** The server's picture of the whole board, at this revision and scheme. */
const serverPicture = (board: Pick<Board, "path" | "rev">, scheme: "light" | "dark") => new URL(`${thumbUrl(board, scheme)}&whole=1`, location.href).href;

/** Pictures this browser took, by board: the object URL, and the revision it shows. */
const [taken, setTaken] = createSignal<ReadonlyMap<string, { url: string; rev: number }>>(new Map());
export { taken };

/** A picture taken here, or the server's. */
const takenOrServer = (board: Pick<Board, "path" | "rev">, scheme: "light" | "dark") => {
	const mine = taken().get(board.path);
	return mine && mine.rev === board.rev ? mine.url : serverPicture(board, scheme);
};

/** One capture, as a check reads it: which adaptor, how long, and how long the page could not respond meanwhile. */
export interface ShotRecord {
	adaptor: ShotAdaptorId;
	path: string;
	ms: number;
	blockedMs: number;
	bytes: number;
	url: string;
}
const records = ((globalThis as { __decksShots?: ShotRecord[] }).__decksShots ??= []);

/** Keep a picture a capture took, and say what it cost. */
async function keep(adaptor: ShotAdaptorId, board: Board, take: () => Promise<Blob | undefined>): Promise<void> {
	let blocked = 0;
	const observer = typeof PerformanceObserver === "function" && PerformanceObserver.supportedEntryTypes?.includes("longtask") ? new PerformanceObserver((list) => list.getEntries().forEach((entry) => (blocked += entry.duration))) : undefined;
	observer?.observe({ type: "longtask" });
	const began = performance.now();
	try {
		const blob = await take();
		if (!blob) return;
		const url = URL.createObjectURL(blob);
		setTaken((was) => {
			const next = new Map(was);
			const old = next.get(board.path);
			// The old picture is let go a moment later, once the sheet has had the new address.
			if (old) setTimeout(() => URL.revokeObjectURL(old.url), 5000);
			next.set(board.path, { url, rev: board.rev });
			return next;
		});
		await new Promise((settle) => setTimeout(settle, 0));
		records.push({ adaptor, path: board.path, ms: Math.round(performance.now() - began), blockedMs: Math.round(blocked), bytes: blob.size, url });
		if (records.length > 50) records.shift();
	} finally {
		observer?.disconnect();
	}
}

/** The tallest a copy is taken, in board pixels, as the server's whole picture is. */
const MAX_H = 12_000;
const heightOf = (doc: Document, board: Board) => Math.min(MAX_H, Math.max(board.h, doc.documentElement.scrollHeight));

export const serverAdaptor: ShotAdaptor = {
	id: "server",
	label: "Server",
	note: "Taken by the server's Chrome from each board's file, as it is when opened fresh.",
	picture: serverPicture,
};

/** A picture of a live page, drawn by the server's Chrome from a snapshot of its markup (`snapshot.ts`). */
export async function takeSnapshot(frame: HTMLIFrameElement, board: Board): Promise<Blob | undefined> {
	const doc = frame.contentDocument;
	if (!doc?.documentElement || board.live) return undefined;
	const html = snapshotOf(doc);
	const scheme = document.documentElement.dataset.colorScheme === "dark" ? "dark" : "light";
	const query = new URLSearchParams({ path: board.path, w: String(board.w), h: String(heightOf(doc, board)), scheme });
	const answer = await fetch(`/api/snapshot?${query}`, { method: "POST", headers: { "Content-Type": "text/html" }, body: html });
	return answer.ok ? await answer.blob() : undefined;
}

export const snapshotAdaptor: ShotAdaptor = {
	id: "snapshot",
	label: "Snapshot",
	note: "The page as you left it, drawn by the server, else the server's own.",
	picture: takenOrServer,
	capture: (frame, board) => keep("snapshot", board, () => takeSnapshot(frame, board)),
};

/**
 * Chrome's HTML-in-Canvas: the live page drawn into the board's own canvas, at the board's full
 * size, and read back. Under the Canvas renderer the page is that canvas's child, which the API
 * needs; under the Documents renderer it is not, and moving a frame reloads it, so this takes
 * nothing there and the board keeps the server's picture.
 */
/** Whether HTML-in-Canvas can draw this live page: only when it is the child of the board's own canvas, with the API on. */
export const canDrawInCanvas = (frame: HTMLIFrameElement) => {
	const canvas = frame.parentElement;
	return canvas instanceof HTMLCanvasElement && canvas.hasAttribute("layoutsubtree") && !!elementContext(canvas);
};

/** A picture of a live page, drawn by Chrome's HTML-in-Canvas into the board's own canvas at full size. */
export async function takeInCanvas(frame: HTMLIFrameElement, board: Board): Promise<Blob | undefined> {
	const canvas = frame.parentElement;
	if (!(canvas instanceof HTMLCanvasElement) || !canvas.hasAttribute("layoutsubtree") || !frame.contentDocument) return undefined;
	const ctx = elementContext(canvas);
	if (!ctx) return undefined;
	// The frame's own box is what is drawn, so the picture takes its shape; content past the
	// box is not in it, as it is not on the canvas either.
	const box = frame.getBoundingClientRect();
	if (!(box.width > 0) || !(box.height > 0)) return undefined;
	const width = Math.min(4096, board.w);
	const height = Math.min(4096, Math.round((width * box.height) / box.width));
	// Drawn into a canvas of the board's full size for this one picture; the board's own
	// drawing at its size on screen is put back at the canvas renderer's next draw.
	canvas.width = width;
	canvas.height = height;
	const ratio = canvasPixelRatio(canvas);
	const scale = ratio && drawScale({ w: width, h: height }, frame.getBoundingClientRect(), ratio);
	if (!scale) return undefined;
	ctx.setTransform(scale.x, 0, 0, scale.y, 0, 0);
	ctx.drawElementImage(frame, 0, 0);
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	return new Promise<Blob | undefined>((resolve) => canvas.toBlob((blob) => resolve(blob ?? undefined), "image/png"));
}

export const canvasAdaptor: ShotAdaptor = {
	id: "canvas",
	label: "Canvas",
	note: "Chrome draws the live page (Canvas renderer and flag), else a snapshot, else the server's.",
	picture: takenOrServer,
	capture: (frame, board) => keep(canDrawInCanvas(frame) ? "canvas" : "snapshot", board, () => canvasOrSnapshot(frame, board)),
};

/** HTML-in-Canvas where this page can be drawn by it, and a snapshot where not or where it failed. */
async function canvasOrSnapshot(frame: HTMLIFrameElement, board: Board): Promise<Blob | undefined> {
	if (canDrawInCanvas(frame)) {
		const drawn = await takeInCanvas(frame, board).catch(() => undefined);
		if (drawn) return drawn;
	}
	return takeSnapshot(frame, board);
}

/** In the order they are tried, and the order Settings lists them. */
export const SHOT_ADAPTORS: ShotAdaptor[] = [canvasAdaptor, snapshotAdaptor, serverAdaptor];

const KEY = "decks.pictures";
const isId = (value: unknown): value is ShotAdaptorId => SHOT_ADAPTORS.some((one) => one.id === value);
const load = (): ShotAdaptorId => {
	try {
		const saved = localStorage.getItem(KEY);
		return isId(saved) ? saved : "canvas";
	} catch {
		return "canvas";
	}
};
/* Canvas when nothing was chosen: the start of the order, so every way is tried. */
const [chosen, setChosen] = createSignal<ShotAdaptorId>(typeof localStorage === "undefined" ? "canvas" : load());

/** The adaptor in use, chosen in Settings and remembered per browser. */
export const shotAdaptor = () => SHOT_ADAPTORS.find((one) => one.id === chosen()) ?? canvasAdaptor;
export const shotAdaptorId = chosen;
export function chooseShotAdaptor(id: ShotAdaptorId): void {
	setChosen(id);
	try {
		localStorage.setItem(KEY, id);
	} catch {
		// Private mode: the choice lasts for this page.
	}
}

/**
 * A board as the person's browser has it now, for an agent's `stage.screenshot` (`stage.call` op
 * `shot`), in the pictures' order from the one chosen in Settings: HTML-in-Canvas when the page can
 * be drawn by it, a snapshot when not, and `none` (the server's picture, taken by the server) when
 * neither can or this browser has no live page for the board. The first two show what the person
 * did on the page.
 */
export async function seenPicture(board: Board): Promise<{ how: "canvas" | "snapshot"; mime: string; data: string } | { how: "none"; why: string }> {
	const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe[data-path]")).find(
		(one) => one.dataset.path === board.path && one.isConnected && (one.contentWindow as (Window & { __boardReady?: boolean }) | null)?.__boardReady === true,
	);
	if (!frame) return { how: "none", why: "the board has no live page in the person's browser" };
	const from = chosen();
	if (from === "server") return { how: "none", why: "pictures are set to Server in the person's Settings" };
	let how: "canvas" | "snapshot" = "snapshot";
	let blob: Blob | undefined;
	if (from === "canvas" && canDrawInCanvas(frame)) {
		how = "canvas";
		blob = await takeInCanvas(frame, board).catch(() => undefined);
	}
	if (!blob) {
		how = "snapshot";
		blob = await takeSnapshot(frame, board).catch(() => undefined);
	}
	if (!blob) return { how: "none", why: "the person's browser could not draw it" };
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return { how, mime: blob.type || "image/png", data: btoa(binary) };
}
