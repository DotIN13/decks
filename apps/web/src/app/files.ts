import { onCleanup, onMount } from "solid-js";
import type { BoardPatch } from "@decks/protocol";
import { toWorld } from "../camera/camera.ts";
import { camera } from "../state/camera.ts";
import { flow, guardDocumentDrops, HEAD_PX, isImage, naturalSize, shapeFor, type FileDropHost } from "../board/file-drop.ts";
import { CARD, MEDIA } from "@decks/pen";
import { cardChildren, CARD_GAP, CARD_PAD, CARD_RADIUS, fileCard, fileItem, FILE_CARD_W, liveFileItem, markdownText } from "../canvas/pen/card-frame.ts";
import type { EditorHost } from "../board/Editor.ts";
import { state } from "../state/deck.ts";
import { notice, working } from "../state/notices.ts";
import { selected } from "../state/selection.ts";
import { send } from "../state/socket.ts";
import { setDraft, setPicking } from "../state/ui.ts";
import { embedPath, mayUpload, uploadAsset } from "./upload.ts";
import { api } from "../connections/connection.ts";
import { openBundle } from "../connections/bundle.ts";
import { can } from "../connections/backend.ts";
import { switchTo } from "../connections/connection.ts";
import { ensureWorker } from "../connections/worker.ts";

/** A `.decks` file dropped on the app: unpacked into this browser and opened, read only. */
async function openDroppedBundle(file: File): Promise<void> {
	try {
		await ensureWorker();
		switchTo(await openBundle(file));
	} catch (failed) {
		notice("warn", (failed as Error).message);
	}
}


/** Pictures the stage's painter decodes itself: these go on the canvas as they are. SVG does not, so it goes on a board. */
const RASTER = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"]);
/** Words the stage can show as a card: markdown, and plain text, which reads as markdown well enough. */
const WORDS = new Set(["md", "markdown", "mdx", "txt", "text"]);
/** A card holds a note's worth of words, not a book: past this a text file goes on a board. */
const CARD_BYTES = 256 * 1024;
/** How wide a dropped picture lands on the stage, at most, in stage pixels. */
const PICTURE_W = 640;
/** How wide a dropped text file's card is, in stage pixels. */
const CARD_W = 480;
/** The gap between items dropped together. */
const GAP = 32;
/** A sound has no picture, so it lands as a strip wide enough for a name and a time. */
const SOUND_W = 420;
const SOUND_H = 72;

/**
 * Films and sounds the server could read (`files/media.ts`).
 *
 * By extension and by what the browser claimed, as a picture is: a file dragged from some
 * desktops arrives with an empty `type`, and a name is only a claim. Whether it really is one is
 * the server's answer — the upload comes back with `media` or it does not, and a file that turns
 * out not to be media is placed as an ordinary dropped file would be.
 */
/** What opens as a document page, edited where it is: the docs server's `EDITABLE`. */
const DOCUMENTS = new Set(["md", "markdown", "txt", "tex", "bib", "sty", "cls", "ltx", "rst", "org", "docx"]);
const PLAYABLE = new Set(["mp4", "m4v", "webm", "mov", "ogv", "mkv", "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "weba"]);
const isPlayable = (file: File) => PLAYABLE.has(extensionOf(file)) || file.type.startsWith("video/") || file.type.startsWith("audio/");

const extensionOf = (file: File) => (file.name.split(".").pop() ?? "").toLowerCase();
const isRaster = (file: File) => RASTER.has(extensionOf(file)) || (file.type.startsWith("image/") && file.type !== "image/svg+xml");
const isWords = (file: File) => file.size <= CARD_BYTES && (WORDS.has(extensionOf(file)) || file.type === "text/markdown" || file.type === "text/plain");
/** Whether a file can be an item on the stage itself rather than something on a board. */
export const onStage = (file: File) => isRaster(file) || isWords(file) || isPlayable(file);

/** A deck-relative asset path as the stage file writes it: from `stages/<name>/`, two folders up. */
const fromStage = (asset: string) => `../../${asset}`;

/** A byte count as a sentence a person reads while waiting. */
function sizeLabel(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Files arriving from outside: dropped on a board, on empty canvas, on the input bar, or
 * pasted.
 *
 * Five routes, one destination — a file is copied into the deck's `assets/` and then
 * mentioned by whichever surface caught it — and this is all of them, which was ~200 lines
 * spread through `App.tsx` between the editor and the keyboard wiring.
 *
 * **The bytes are always copied into the deck.** A deck is self-contained: an embed of
 * something on your desktop is a board that breaks the moment you tidy up. Identical files
 * are stored once, and nothing is ever overwritten (`files/upload.ts`).
 *
 * Where the four routes differ is only what they have to decide *before* the copy: a drop
 * inside a frame knows the cursor and those pixels are board pixels; a drop on empty canvas
 * has no board yet and has to make one, sized to hold what landed; the input bar has no
 * position at all and mentions the path where the caret is; and a paste has neither, so it
 * lands on the selected board, at the middle of it.
 */
export function createFileDrops(deps: { editor: EditorHost }) {
	/** Boards asked for with a `request`, waiting to hear their paths (`board.created`). */
	const created = new Map<string, (path: string) => void>();

	/**
	 * Ask the server for a board and hear back which path it got.
	 *
	 * The server mints the name, so every caller that wants to *do* something with a board it
	 * asked for — fill it with the file that was dropped, select it, fly to it — has to wait to
	 * be told what it is called. `ask` is handed the request id to put on its own message, which
	 * is what lets one registry serve `board.create` and `agent.mirror` alike.
	 *
	 * Ten seconds, then `undefined`: a promise that never settles is a button that never comes
	 * back, and the caller can say so in a sentence.
	 */
	const askForBoard = (ask: (request: string) => void): Promise<string | undefined> => {
		const request = `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		return new Promise<string | undefined>((resolve) => {
			created.set(request, resolve);
			ask(request);
			setTimeout(() => {
				if (created.delete(request)) resolve(undefined);
			}, 10_000);
		});
	};

	const dropOnBoard = async (path: string, files: File[], at: { x: number; y: number }) => {
		const board = state.boards.find((candidate) => candidate.path === path);
		if (!board) return;
		const report = working(files.length > 1 ? `Adding ${files.length} files…` : `Adding ${files[0]?.name ?? "file"}…`);
		// The insert variant specifically, so the summary below can read back `embed`.
		const inserts: Extract<BoardPatch, { op: "insert" }>[] = [];
		const failures: string[] = [];
		let reused = 0;

		/*
		 * Laid out before anything is uploaded, and for the whole batch at once. The
		 * shapes are read from the files locally — an image's own pixels, mostly — and
		 * `flow` needs to see all of them to put them in a row that wraps at the board's
		 * edge instead of a pile at the cursor.
		 */
		const boxes = flow(await Promise.all(files.map(shapeFor)), at, board.w);

		for (const [index, file] of files.entries()) {
			const of = files.length > 1 ? `${index + 1} of ${files.length} · ` : "";
			try {
				const asset = await uploadAsset(file, (fraction) =>
					report.update(`${of}${file.name} · ${Math.round(fraction * 100)}% of ${sizeLabel(file.size)}`),
				);
				if (asset.reused) reused += 1;
				/*
				 * A film was laid out at sixteen by nine, because nothing had read it yet; the
				 * upload answers with the picture's real size, so the box takes that shape before
				 * it is written. The poster the server wrote rides along as `data-poster`, which
				 * is what the player shows before it has decoded a frame (`lib/board.js`).
				 */
				const media = asset.media;
				const shaped = media?.w && media.h ? { ...boxes[index]!, height: Math.round(boxes[index]!.width * (media.h / media.w)) + HEAD_PX } : boxes[index]!;
				inserts.push({
					op: "insert",
					// `image` and `embed` render the same markup; the kind is what names the
					// component, so `image-1` in the file says what it is without opening it.
					kind: isImage(file) ? "image" : "embed",
					id: "",
					at: shaped,
					embed: embedPath(path, asset.path),
					...(media?.poster ? { attrs: { "data-poster": embedPath(path, media.poster) } } : {}),
				});
			} catch (error) {
				failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		if (inserts.length > 0) deps.editor.patch(path, inserts);
		const added =
			inserts.length === 0
				? ""
				: `${inserts.length === 1 ? inserts[0]?.embed?.split("/").pop() : `${inserts.length} files`} added${reused > 0 ? ` (${reused} already in the deck)` : ""}`;
		report.done([added, ...failures].filter(Boolean).join(" · ") || undefined, failures.length > 0 ? "warn" : "info");
	};

	/**
	 * What a board frame hands back when files are dropped inside it (`file-drop.ts`).
	 *
	 * Per board, because the drop belongs to the board it landed on: the frame knows
	 * where in its own document the cursor was, and those pixels are board pixels.
	 */
	const drops = (path: string): FileDropHost => ({
		enabled: () => deps.editor.enabled(),
		drop: (files, at) => void dropOnBoard(path, files, at),
	});

	/**
	 * One file from the device, copied into the deck, answered as an embed path.
	 *
	 * The other end of the file picker (`board/FilePicker.tsx`), and the whole of "getting a
	 * photo off a phone onto a board": the upload route and the insert path were already there
	 * for the desktop drag (§6.9), and a drag is the one gesture a touchscreen does not
	 * have. So this is the same two steps in the other order — the bytes go into the deck
	 * first, and the path comes back for the component that asked.
	 */
	const addFile = async (board: string | undefined, file: File): Promise<string | undefined> => {
		const report = working(`Adding ${file.name}…`);
		try {
			const asset = await uploadAsset(file, (fraction) =>
				report.update(`${file.name} · ${Math.round(fraction * 100)}% of ${sizeLabel(file.size)}`),
			);
			report.done(`${file.name} added${asset.reused ? " (already in the deck)" : ""}`);
			// Relative to the board that asked, because a deck is self-contained and an
			// absolute path is a board that breaks when the deck moves.
			return board ? embedPath(board, asset.path) : asset.path;
		} catch (error) {
			report.done(`${file.name}: ${error instanceof Error ? error.message : String(error)}`, "warn");
			return undefined;
		}
	};

	/**
	 * Files dropped on the input bar: copied into the deck, then mentioned where the caret is.
	 *
	 * The paperclip's two steps without the picker between them. Sequential, so the progress
	 * line reads one file at a time, and the mentions arrive together once every copy is in.
	 */
	const intoComposer = async (files: File[]) => {
		const agentId = state.focused;
		const paths: string[] = [];
		for (const file of files) {
			const path = await addFile(undefined, file);
			if (path) paths.push(path);
		}
		if (paths.length > 0) setDraft({ text: paths.map((path) => `@${path}`).join(" "), at: Date.now(), insert: true, ...(agentId ? { agentId } : {}) });
	};

	/**
	 * Files dropped on empty canvas, all of them on the stage itself where they landed: pictures, text,
	 * films and sounds as items of their own (`ontoStage`), anything else — a PDF, an SVG, a web page
	 * — as a file card (`asFileCards`).
	 */
	const onEmptyCanvas = async (dropped: File[], at: { x: number; y: number }) => {
		const stage = document.querySelector(".stage");
		if (!stage) return;
		// Asked first, before anything is made for them: a big file said no to leaves no board behind.
		const files: File[] = [];
		for (const file of dropped) if (await mayUpload(file)) files.push(file);
		if (files.length === 0) return;
		// Over a card, every file goes into it, between the blocks where it lands.
		const card = (globalThis as { __decksCardAt?: (x: number, y: number) => { card: string; index: number; inner: number } | undefined }).__decksCardAt?.(at.x, at.y);
		if (card) return intoCard(files, card);
		const direct = files.filter(onStage);
		const rest = files.filter((file) => !onStage(file));
		const middle = toWorld(camera(), { width: stage.clientWidth, height: stage.clientHeight }, at);
		if (direct.length > 0) await ontoStage(direct, middle);
		if (rest.length > 0) await asFileCards(rest, { x: middle.x, y: middle.y + (direct.length ? 260 : 0) });
	};

	/**
	 * Files the stage has no item of its own for — a PDF, an SVG, a web page, a spreadsheet — copied
	 * into the deck and put on the canvas as file cards (`fileCard`): a picture of each where the
	 * server can draw one, its name and kind under it. In a row centred on `middle`, a stage point.
	 */
	const asFileCards = async (files: File[], middle: { x: number; y: number }) => {
		const report = working(files.length > 1 ? `Adding ${files.length} files…` : `Adding ${files[0]?.name ?? "file"}…`);
		const paths: string[] = [];
		const failures: string[] = [];
		for (const file of files) {
			try {
				paths.push((await uploadAsset(file, (fraction) => report.update(`${file.name}: ${Math.round(fraction * 100)}% of ${sizeLabel(file.size)}`))).path);
			} catch (error) {
				failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		await placeFileCards(paths, middle);
		report.done([paths.length ? `${paths.length === 1 ? files[0]?.name : `${paths.length} files`} put on the canvas` : "", ...failures].filter(Boolean).join("; ") || undefined, failures.length ? "warn" : "info");
	};

	/**
	 * A PDF or a web page as a board that is the file, edge to edge (`newFileBoard` on the server):
	 * a PDF in its first page's shape, its other pages scrolling inside; a page at a laptop's shape,
	 * live. Centred on `middle`. Answers the board's path.
	 */
	const fileBoard = async (path: string, middle: { x: number; y: number }, aimed = true): Promise<string | undefined> => {
		const pdf = /\.pdf$/i.test(path);
		// A PDF's first page gives the board its shape; a web page needs no picture to be a page.
		const where = pdf ? ((await (await fetch(api(`/where?path=${encodeURIComponent(path)}`))).json().catch(() => ({}))) as { preview?: { w: number; h: number } }) : {};
		const w = pdf ? 816 : 1200;
		// The file's own shape, under the 40px bar that names it and reloads it (`board.css`, `data-bare`).
		const h = (pdf && where.preview ? Math.round((w * where.preview.h) / Math.max(1, where.preview.w)) : pdf ? 1056 : 750) + 40;
		return askForBoard((request) =>
			send({ type: "board.create", file: path, size: { w, h }, ...(aimed ? { at: { x: Math.round(middle.x - w / 2), y: Math.round(middle.y - h / 2) } } : {}), request }),
		);
	};
	/** A PDF or a web page is a board that is the file; an SVG is a picture shown live on the canvas (`liveFileItem`). */
	const FULL = /\.(pdf|html?)$/i;
	const LIVE = /\.svg$/i;

	/** Deck files as file cards in a row centred on `middle`, each with the picture the server makes of it (`/api/where`); a PDF or a web page as a board of its own. */
	const placeFileCards = async (all: string[], middle: { x: number; y: number }) => {
		const agentId = state.focused;
		for (const path of all.filter((one) => FULL.test(one))) await fileBoard(path, middle);
		const stamp = Date.now().toString(36);
		let n = 0;
		const fresh = () => `file-${stamp}-${n++}`;
		const live = all.filter((one) => LIVE.test(one));
		if (agentId && live.length) {
			const ops: Array<Record<string, unknown>> = [];
			let at = middle.x;
			for (const path of live) {
				const where = (await (await fetch(api(`/where?path=${encodeURIComponent(path)}`))).json().catch(() => ({}))) as { preview?: { preview: string; w: number; h: number } };
				const node = liveFileItem(path, fresh, { ...(where.preview ? { still: where.preview.preview, w: where.preview.w, h: where.preview.h } : {}), url: fromStage });
				const w = Number(node.width);
				ops.push({ op: "insert", node, box: { x1: Math.round(at - w / 2), y1: Math.round(middle.y - 200), x2: Math.round(at + w / 2) } });
				at += w + GAP;
			}
			send({ type: "stage.pen.edit", agentId, ops });
		}
		const paths = all.filter((one) => !FULL.test(one) && !LIVE.test(one));
		if (!agentId || paths.length === 0) return;
		const total = paths.length * FILE_CARD_W + GAP * (paths.length - 1);
		let x = Math.round(middle.x - total / 2);
		const ops: Array<Record<string, unknown>> = [];
		for (const path of paths) {
			const where = (await (await fetch(api(`/where?path=${encodeURIComponent(path)}`))).json().catch(() => ({}))) as { preview?: { preview: string; w: number; h: number; pages?: number; title?: string } };
			// Its path from the stage's own folder, as a file's chip in a card has it, so a double-click opens it (`openFileOf`).
			const node = fileCard(fromStage(path), fresh, { ...(where.preview ?? {}), url: fromStage });
			const tall = where.preview ? Math.min(420, (FILE_CARD_W * where.preview.h) / Math.max(1, where.preview.w)) + 52 : 52;
			ops.push({ op: "insert", node, box: { x1: x, y1: Math.round(middle.y - tall / 2), x2: x + FILE_CARD_W } });
			x += FILE_CARD_W + GAP;
		}
		send({ type: "stage.pen.edit", agentId, ops });
	};

	/**
	 * Files dropped on a card, each copied into the deck and put among its blocks where it landed: a
	 * picture as a picture as wide as the card's words at most, a text file's words as a block, and any
	 * other file (a PDF, a film) as a file's chip, which the card writes as `![[path]]`. The server
	 * gives the new items their ids.
	 */
	const intoCard = async (files: File[], into: { card: string; index: number; inner: number }) => {
		const agentId = state.focused;
		if (!agentId) return;
		const report = working(files.length > 1 ? `Adding ${files.length} files to the card…` : `Adding ${files[0]?.name ?? "file"} to the card…`);
		const ops: Array<Record<string, unknown>> = [];
		const failures: string[] = [];
		const none = () => "";
		for (const file of files) {
			try {
				if (isWords(file)) {
					ops.push({ op: "insert", parent: into.card, index: into.index + ops.length, node: markdownText("", (await file.text()).trim()) });
					continue;
				}
				const natural = isRaster(file) ? await naturalSize(file) : undefined;
				const asset = await uploadAsset(file, (fraction) => report.update(`${file.name} · ${Math.round(fraction * 100)}% of ${sizeLabel(file.size)}`));
				if (isRaster(file)) {
					const w = Math.round(Math.min(into.inner, natural?.width ?? into.inner));
					const h = Math.round(natural ? (w * natural.height) / Math.max(1, natural.width) : w * 0.5625);
					ops.push({ op: "insert", parent: into.card, index: into.index + ops.length, node: { type: "rectangle", name: file.name, cornerRadius: 6, width: w, height: h, fill: { type: "image", url: fromStage(asset.path), mode: "fill" } } });
				} else ops.push({ op: "insert", parent: into.card, index: into.index + ops.length, node: fileItem(fromStage(asset.path), none) });
			} catch (error) {
				failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		if (ops.length) send({ type: "stage.pen.edit", agentId, ops });
		report.done([ops.length ? `${ops.length === 1 ? files[0]?.name : `${ops.length} files`} put in the card` : "", ...failures].filter(Boolean).join(" · ") || undefined, failures.length ? "warn" : "info");
	};

	/**
	 * Pictures and text files, put on the stage itself: a picture is a rectangle filled with it, at
	 * its own proportions, and a text file is a markdown card holding its words. Copied into the
	 * deck first like every other file, so the stage file refers to `assets/`, never to the desktop.
	 * Laid in a row centred on `middle`, a stage point.
	 */
	const ontoStage = async (files: File[], middle: { x: number; y: number }) => {
		const agentId = state.focused;
		if (!agentId) return;
		const report = working(files.length > 1 ? `Adding ${files.length} files…` : `Adding ${files[0]?.name ?? "file"}…`);
		const items: Array<{ node: Record<string, unknown>; w: number; h?: number }> = [];
		const failures: string[] = [];
		for (const [index, file] of files.entries()) {
			const of = files.length > 1 ? `${index + 1} of ${files.length} · ` : "";
			try {
				if (isWords(file)) {
					const words = await file.text();
					// A card: a column of its blocks (`canvas/pen/card-frame.ts`), each given its id by the server.
					const children = cardChildren(words, [], { fresh: () => "", inner: CARD_W - CARD_PAD * 2 });
					items.push({ node: { type: "frame", name: file.name, layout: "vertical", gap: CARD_GAP, padding: CARD_PAD, cornerRadius: CARD_RADIUS, metadata: { type: CARD, file: file.name }, children }, w: CARD_W });
					continue;
				}
				const natural = (await naturalSize(file)) ?? { width: 480, height: 360 };
				const asset = await uploadAsset(file, (fraction) => report.update(`${of}${file.name} · ${Math.round(fraction * 100)}% of ${sizeLabel(file.size)}`));
				/*
				 * A film or a sound: pen's own rectangle, filled with the still the server wrote and
				 * marked as media (`@decks/pen`, `MEDIA`). pen.dev opens it as the rectangle it is,
				 * showing the poster, which is the right thing to show for something not playing.
				 * The canvas draws the still and puts a play badge on it; nothing decodes until it is
				 * pressed, which is what the measurement asked for.
				 */
				// Only a file named as a film or a sound: ffmpeg reads a still picture as a one-frame film.
				if (asset.media && isPlayable(file)) {
					const facts = asset.media;
					const sound = facts.kind === "audio";
					const w = sound ? SOUND_W : Math.min(PICTURE_W, facts.w ?? natural.width);
					const h = sound ? SOUND_H : Math.round((w * (facts.h ?? natural.height)) / Math.max(1, facts.w ?? natural.width));
					items.push({
						node: {
							type: "rectangle",
							name: file.name,
							cornerRadius: 8,
							...(facts.poster ? { fill: { type: "image", url: fromStage(facts.poster), mode: "fill" } } : { fill: "#1f2328" }),
							metadata: {
								type: MEDIA,
								kind: facts.kind,
								file: asset.path,
								...(facts.poster ? { poster: facts.poster } : {}),
								...(facts.seconds === undefined ? {} : { seconds: facts.seconds }),
							},
						},
						w,
						h,
					});
					continue;
				}
				const w = Math.min(PICTURE_W, natural.width);
				const h = Math.round((w * natural.height) / Math.max(1, natural.width));
				items.push({ node: { type: "rectangle", name: file.name, cornerRadius: 8, fill: { type: "image", url: fromStage(asset.path), mode: "fill" } }, w, h });
			} catch (error) {
				failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		if (items.length > 0) {
			const total = items.reduce((sum, item) => sum + item.w, 0) + GAP * (items.length - 1);
			const tallest = Math.max(...items.map((item) => item.h ?? 240));
			let x = Math.round(middle.x - total / 2);
			const y = Math.round(middle.y - tallest / 2);
			const stamp = Date.now().toString(36);
			const ops = items.map((item, i) => {
				const box = item.h === undefined ? { x1: x, y1: y, x2: x + item.w } : { x1: x, y1: y, x2: x + item.w, y2: y + item.h };
				x += item.w + GAP;
				return { op: "insert", node: { ...item.node, id: `drop-${stamp}-${i}` }, box };
			});
			send({ type: "stage.pen.edit", agentId, ops });
		}
		const added = items.length === 0 ? "" : `${items.length === 1 ? files[0]?.name : `${items.length} files`} put on the canvas`;
		report.done([added, ...failures].filter(Boolean).join(" · ") || undefined, failures.length > 0 ? "warn" : "info");
	};

	/**
	 * A file on the clipboard, landing on the selected board.
	 *
	 * The sibling of the drop path, and the one edge §8 listed against §6.9. A paste has no
	 * cursor position — that is the whole difference from a drop — so it needs a rule
	 * instead of a point: **the selected board, at the middle of it.** The selection is
	 * the board the user is working on and it is already visible on screen, which makes
	 * this the smallest rule that is never surprising; nothing is invented when there is
	 * no selection, exactly as nothing is invented for a file dropped on empty canvas.
	 *
	 * A paste while something is focused belongs to that thing: the composer, an
	 * inspector field, a run of text being retyped. A screenshot pasted into a sentence
	 * you are writing is not an embed.
	 */
	const paste = (files: File[]) => {
		if (files.length === 0) return;
		const path = selected();
		const board = path ? state.boards.find((candidate) => candidate.path === path) : undefined;
		if (!board) {
			// Nothing selected: pictures and text land on the canvas, in the middle of the view.
			const stage = document.querySelector(".stage");
			const direct = files.filter(onStage);
			if (stage && direct.length > 0) {
				void ontoStage(direct, toWorld(camera(), { width: stage.clientWidth, height: stage.clientHeight }, { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }));
				if (direct.length < files.length) notice("info", "Only pictures and text files can go straight on the canvas. Pick a board to paste the rest onto it.");
				return;
			}
			notice("info", "Pick a board first. A pasted file becomes an embed, and an embed lives on a board.");
			return;
		}
		if (!deps.editor.enabled()) {
			notice("info", "Zoom in until the board is live, then paste.");
			return;
		}
		void dropOnBoard(board.path, files, { x: board.w / 2, y: board.h / 2 });
	};

	/**
	 * A blank board, centred on a point of the canvas.
	 *
	 * The double-click on empty canvas. Nothing is filled in afterwards — a blank board *is* the
	 * whole act — so this is the drop path's request mechanism without a file: ask with a
	 * `request`, hear the path back (`board.created`), and give up quietly if no path arrives.
	 *
	 * Centred rather than hung from the pointer's top-left corner, because a double-click names
	 * the place somebody wants the board and the place is the board, not its corner. The size is
	 * the blank board's own (880×400), sent for that arithmetic and not to choose anything.
	 */
	const boardAt = async (at: { x: number; y: number }, format: "board" | "slides" = "board"): Promise<string | undefined> => {
		const stage = document.querySelector(".stage");
		if (!stage) return undefined;
		// `at` is already in stage pixels — the stage is the viewport (`camera/coords.ts`).
		const middle = toWorld(camera(), { width: stage.clientWidth, height: stage.clientHeight }, at);
		const size = { w: 880, h: 400 };
		return askForBoard((request) =>
			send({
				type: "board.create",
				format,
				title: "Untitled",
				size,
				at: { x: Math.round(middle.x - size.w / 2), y: Math.round(middle.y - size.h / 2) },
				request,
			}),
		);
	};

	/**
	 * A document opened as a page you type into, centred where the Add menu was opened.
	 *
	 * The file comes from the picker the app already has: anything in the deck or a root it
	 * declares, or a file from the computer copied into the deck first. The server makes the
	 * board (`newDocBoard`); the file is edited where it is, and its history is kept in `docs/`.
	 */
	const documentAt = async (at: { x: number; y: number }): Promise<string | undefined> => {
		const stage = document.querySelector(".stage");
		if (!stage) return undefined;
		const picked = await new Promise<string | undefined>((resolve) =>
			setPicking({
				resolve: (path) => {
					setPicking(undefined);
					resolve(path);
				},
				google: true,
			}),
		);
		if (!picked) return undefined;
		const middle = toWorld(camera(), { width: stage.clientWidth, height: stage.clientHeight }, at);
		const size = { w: 1000, h: 1100 };
		// A Google Doc comes back from the picker as `google:<address>`; the server links it before it makes the board.
		const google = picked.startsWith("google:") ? picked.slice(7) : undefined;
		return askForBoard((request) =>
			send({
				type: "board.create",
				...(google ? { google } : { document: picked }),
				at: { x: Math.round(middle.x - size.w / 2), y: Math.round(middle.y - size.h / 2) },
				request,
			}),
		);
	};

	/**
	 * A file put on the canvas from the File button, centred where it was asked for. It is chosen in
	 * the picker — anything in the deck or a root it declares, a file from this device copied in, or
	 * a Google Doc — and placed by what it is: a document opens as a page edited where it is, a
	 * picture, a film or a sound is an item on the canvas itself, and anything else (a PDF, a web
	 * page, a spreadsheet) gets a board holding it, as a dropped file does. Answers the board made, if any.
	 */
	/**
	 * A file from the picker, placed by what it is. `aimed` is false from the toolbar's button, which names
	 * no point: a board then takes the nearest open slot beside the newest board, as the Board button's does,
	 * rather than landing on whatever is in the middle of the screen.
	 */
	const fileAt = async (at: { x: number; y: number }, aimed = true): Promise<string | undefined> => {
		const stage = document.querySelector(".stage");
		if (!stage) return undefined;
		const picked = await new Promise<string | undefined>((resolve) =>
			setPicking({
				resolve: (path) => {
					setPicking(undefined);
					resolve(path);
				},
				google: true,
				purpose: "canvas",
			}),
		);
		if (!picked) return undefined;
		const middle = toWorld(camera(), { width: stage.clientWidth, height: stage.clientHeight }, at);
		const extension = (picked.split("/").pop()?.split(".").pop() ?? "").toLowerCase();
		const google = picked.startsWith("google:") ? picked.slice(7) : undefined;
		if (google || DOCUMENTS.has(extension)) {
			const size = { w: 1000, h: 1100 };
			// A Google Doc comes back from the picker as `google:<address>`; the server links it before it makes the board.
			return askForBoard((request) =>
				send({
					type: "board.create",
					...(google ? { google } : { document: picked }),
					...(aimed ? { at: { x: Math.round(middle.x - size.w / 2), y: Math.round(middle.y - size.h / 2) } } : {}),
					request,
				}),
			);
		}
		const agentId = state.focused;
		// In the deck, the stage file refers to it where it is, with nothing copied: the server says where that is, and what a film or a sound is.
		const where = (await (await fetch(api(`/where?path=${encodeURIComponent(picked)}`))).json().catch(() => ({ inDeck: false }))) as { inDeck: boolean; path?: string; media?: { kind: "video" | "audio"; poster?: string; seconds?: number; w?: number; h?: number } };
		const inDeck = where.inDeck && !!where.path;
		const deckPath = where.path ?? picked;
		const place = (node: Record<string, unknown>, w: number, h: number) => {
			if (!agentId) return;
			const box = { x1: Math.round(middle.x - w / 2), y1: Math.round(middle.y - h / 2), x2: Math.round(middle.x + w / 2), y2: Math.round(middle.y + h / 2) };
			send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { ...node, id: `file-${Date.now().toString(36)}` }, box }] });
		};
		const name = picked.split("/").pop() ?? picked;
		if (inDeck && RASTER.has(extension)) {
			const natural = await new Promise<{ width: number; height: number }>((resolve) => {
				const image = new Image();
				image.onload = () => resolve({ width: image.naturalWidth || 480, height: image.naturalHeight || 360 });
				image.onerror = () => resolve({ width: 480, height: 360 });
				image.src = api(`/file?path=${encodeURIComponent(deckPath)}`);
			});
			const w = Math.min(PICTURE_W, natural.width);
			place({ type: "rectangle", name, cornerRadius: 8, fill: { type: "image", url: fromStage(deckPath), mode: "fill" } }, w, Math.round((w * natural.height) / Math.max(1, natural.width)));
			return undefined;
		}
		if (inDeck && PLAYABLE.has(extension)) {
			const facts = where.media;
			if (facts) {
				const sound = facts.kind === "audio";
				const w = sound ? SOUND_W : Math.min(PICTURE_W, facts.w ?? 640);
				const h = sound ? SOUND_H : Math.round((w * (facts.h ?? 360)) / Math.max(1, facts.w ?? 640));
				place(
					{
						type: "rectangle",
						name,
						cornerRadius: 8,
						...(facts.poster ? { fill: { type: "image", url: fromStage(facts.poster), mode: "fill" } } : { fill: "#1f2328" }),
						metadata: { type: MEDIA, kind: facts.kind, file: deckPath, ...(facts.poster ? { poster: facts.poster } : {}), ...(facts.seconds === undefined ? {} : { seconds: facts.seconds }) },
					},
					w,
					h,
				);
				return undefined;
			}
		}
		// A PDF or a web page: a board that is the file. Anything else in the deck, an SVG among it: an item on the canvas, the file used where it is.
		if (FULL.test(name)) return fileBoard(inDeck ? deckPath : picked, middle, aimed);
		if (inDeck) {
			await placeFileCards([deckPath], middle);
			return undefined;
		}
		// A file outside the deck: its bytes, the way a drop brings them.
		const response = await fetch(api(`/file?path=${encodeURIComponent(picked)}`));
		if (!response.ok) {
			notice("warn", `${name} could not be read (${response.status}).`);
			return undefined;
		}
		const blob = await response.blob();
		await onEmptyCanvas([new File([blob], name, { type: blob.type })], at);
		return undefined;
	};

	/** A board asked for by a drop heard its path — see `board.created` in the frame switch. */
	const hearBoard = (request: string, path: string): boolean => {
		const waiting = created.get(request);
		if (!waiting) return false;
		created.delete(request);
		waiting(path);
		return true;
	};

	/**
	 * The two document-wide listeners: a paste, and a drop that missed every board.
	 *
	 * Both are on the document because both can land anywhere — over the rail, over the
	 * conversation, in the gap between boards — and a drop the app does not handle would be
	 * the browser opening the file, which unloads the app: socket, camera and all.
	 */
	const install = (deps: { preview(): unknown }) => {
		onMount(() => {
			const onPaste = (event: ClipboardEvent) => {
				// `closest` is asked for rather than assumed: a paste with nothing focused
				// targets the document, which is not an element.
				const target = event.target as HTMLElement | null;
				if (target?.closest?.("input, textarea, [contenteditable]")) return;
				const files = Array.from(event.clipboardData?.files ?? []);
				if (files.length === 0) return;
				event.preventDefault();
				paste(files);
			};
			document.addEventListener("paste", onPaste);
			onCleanup(() => document.removeEventListener("paste", onPaste));
		});

		/*
		 * Reaching here means the drop missed every live board, since a drop over one is
		 * consumed inside that frame's document, and missed the input bar, which takes its own.
		 * Over a board too small to be live it is a notice — zoom in; on empty canvas the files
		 * get a board of their own, where they were dropped.
		 */
		onMount(() => {
			onCleanup(
				guardDocumentDrops(document, (at, files) => {
					// A canvas file opens as a canvas, wherever it lands (`connections/`).
					const bundle = files.find((file) => /\.decks$/i.test(file.name));
					if (bundle) {
						void openDroppedBundle(bundle);
						return;
					}
					if (!can("write")) {
						notice("info", "This canvas was opened from a file, so it can only be read.");
						return;
					}
					// A board zoomed out has no node, only its picture on the sheet: the stage says whether one is there.
					const over = document.elementFromPoint(at.x, at.y)?.closest(".board-node, .bar-layer .chrome") ?? (globalThis as { __decksPictureAt?: (x: number, y: number) => string | undefined }).__decksPictureAt?.(at.x, at.y);
					// While the timeline is being previewed the frames take no pointer events, so
					// every drop arrives here — and "zoom in" would be a lie about why.
					if (deps.preview()) {
						notice("info", "That is a board as it used to be. Let go of the timeline first.");
						return;
					}
					if (over) {
						notice("info", "Zoom in until the board is live, then drop the file on it.");
						return;
					}
					if (files.length > 0) void onEmptyCanvas(files, at);
				}),
			);
		});
	};

	return { drops, addFile, intoComposer, paste, boardAt, documentAt, fileAt, askForBoard, hearBoard, install };
}
