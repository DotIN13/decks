import { onCleanup, onMount } from "solid-js";
import { toWorld } from "@decks/canvas/camera";
import { camera } from "../state/camera.ts";
import { guardDocumentDrops, naturalSize } from "../board/file-drop.ts";
import { cardPicture, centredOp, fileCardOps, fileItem, liveFileOps, markdownText, mediaItem, pictureItem, rowOps, wordsCard, type DroppedItem, type FilePreview, type SizedItem } from "@decks/canvas/tools";
import { state } from "../state/deck.ts";
import { notice, working } from "../state/notices.ts";
import { send } from "../state/socket.ts";
import { setDraft, setPicking } from "../state/ui.ts";
import { mayUpload, uploadAsset } from "./upload.ts";
import { api } from "../connections/connection.ts";
import { openBundle } from "../connections/bundle.ts";
import { can } from "../connections/backend.ts";
import { switchTo } from "../connections/connection.ts";
import { ensureWorker } from "../connections/worker.ts";
import { editDrawing, stageOnScreen } from "../state/decks.ts";
import { viewOnly } from "../state/stages.ts";
import { authedSrc } from "../lib/authed.tsx";

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

/** A canvas's folder, deck-relative, by its name: `canvases/<name>`, or `shared/canvases/<owner>/<canvas>` for a friend's (`deck/layout.ts`). */
const folderOf = (name: string) => {
	const friend = /^shared\/([^/]+)\/([^/]+)$/.exec(name);
	return friend ? `shared/canvases/${friend[1]}/${friend[2]}` : `canvases/${name}`;
};
/**
 * A deck path as the canvas on screen's drawing writes it: a file in the canvas's own folder by its
 * path there (`files/a.png`), anything else climbing out of the folder to the deck (`../../assets/a.png`),
 * which the server copies into the canvas's `files/` as it writes the drawing.
 */
const fromStage = (asset: string) => {
	const name = stageOnScreen();
	if (!name) return `../../${asset}`;
	const folder = folderOf(name);
	if (asset.startsWith(`${folder}/`)) return asset.slice(folder.length + 1);
	return `${"../".repeat(folder.split("/").length)}${asset}`;
};

/**
 * Why nothing may be dropped on the canvas on screen, or on the canvas a board is in: a friend's,
 * shared with you to view. Said as a notice, with the way to change it, before anything is sent.
 */
const refusedOn = (canvas: string | undefined): boolean => {
	const row = viewOnly(canvas);
	if (!row) return false;
	notice("warn", `${row.title} is shared with you to view, by ${row.shared?.owner ?? "its owner"}: it follows their copy, and only they can change it. To change it, make your own copy: View only · Make a copy, beside the canvas's name.`);
	return true;
};

/** A byte count as a sentence a person reads while waiting. */
function sizeLabel(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Files arriving from outside: dropped on the canvas (empty or over a board), on the input bar,
 * or pasted.
 *
 * **The bytes are always copied into the deck.** A deck is self-contained: an embed of
 * something on your desktop is a board that breaks the moment you tidy up. Identical files
 * are stored once, and nothing is ever overwritten (`files/upload.ts`).
 *
 * **Nothing goes into a board.** A drop lands on the canvas where it was let go, over a board or
 * not; a paste lands on the canvas in the middle of the view; the input bar mentions the path
 * where the caret is.
 */
export function createFileDrops() {
	/** Documents asked for with a `request`, waiting to hear their items' paths (`document.created`). */
	const created = new Map<string, (path: string) => void>();

	/**
	 * Ask the server for a document item and hear back which path it got on the stage.
	 *
	 * The server mints the item's id, so a caller that wants to *do* something with the item it
	 * 	 * asked for — select it, fly to it — has to wait to be told what it is called. `ask` is handed the
	 * request id to put on its own message.
	 *
	 * Ten seconds, then `undefined`: a promise that never settles is a button that never comes
	 * back, and the caller can say so in a sentence.
	 */
	const askFor = (ask: (request: string) => void): Promise<string | undefined> => {
		const request = `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		return new Promise<string | undefined>((resolve) => {
			created.set(request, resolve);
			ask(request);
			setTimeout(() => {
				if (created.delete(request)) resolve(undefined);
			}, 10_000);
		});
	};

	/**
	 * One file from the device, copied into the deck, answered as an embed path.
	 *
	 * The other end of the file picker (`board/FilePicker.tsx`): the bytes go into the deck's
	 * `assets/` first, and the path comes back for whoever asked.
	 */
	const addFile = async (file: File): Promise<string | undefined> => {
		const report = working(`Adding ${file.name}…`);
		try {
			const asset = await uploadAsset(file, (fraction) => report.update(`${file.name} · ${Math.round(fraction * 100)}% of ${sizeLabel(file.size)}`));
			report.done(`${file.name} added${asset.reused ? " (already in the deck)" : ""}`);
			return asset.path;
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
			const path = await addFile(file);
			if (path) paths.push(path);
		}
		if (paths.length > 0) setDraft({ text: "", files: paths, at: Date.now(), insert: true, ...(agentId ? { agentId } : {}) });
	};

	/**
	 * Files dropped on empty canvas, all of them on the stage itself where they landed: pictures, text,
	 * films and sounds as items of their own (`ontoStage`), anything else — a PDF, an SVG, a web page
	 * — as a file card (`asFileCards`).
	 */
	const onEmptyCanvas = async (dropped: File[], at: { x: number; y: number }, over?: { card: string; index: number; inner: number }) => {
		const stage = document.querySelector(".stage, iframe.canvas-frame");
		if (!stage || refusedOn(stageOnScreen())) return;
		// Asked first, before anything is made for them: a big file said no to leaves no board behind.
		const files: File[] = [];
		for (const file of dropped) if (await mayUpload(file)) files.push(file);
		if (files.length === 0) return;
		// Over a card, every file goes into it, between the blocks where it lands: the canvas frame says which.
		const card = over ?? (globalThis as { __decksCardAt?: (x: number, y: number) => { card: string; index: number; inner: number } | undefined }).__decksCardAt?.(at.x, at.y);
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
				paths.push((await uploadAsset(file, (fraction) => report.update(`${file.name}: ${Math.round(fraction * 100)}% of ${sizeLabel(file.size)}`), stageOnScreen())).path);
			} catch (error) {
				failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		await placeFileCards(paths, middle);
		report.done([paths.length ? `${paths.length === 1 ? files[0]?.name : `${paths.length} files`} put on the canvas` : "", ...failures].filter(Boolean).join("; ") || undefined, failures.length ? "warn" : "info");
	};

	/** An SVG is a picture shown live on the canvas (`liveFileItem`). */
	const LIVE = /\.svg$/i;

	/** Deck files as file cards in a row centred on `middle`, each with the picture the server makes of it (`/api/where`): a PDF's first page, a web page's. */
	const placeFileCards = async (all: string[], middle: { x: number; y: number }) => {
		const agentId = state.focused;
		const stamp = Date.now().toString(36);
		let n = 0;
		const fresh = () => `file-${stamp}-${n++}`;
		/** What the server made of a deck file to show it by (`/api/where`). */
		const previewOf = async (path: string) => ((await (await fetch(api(`/where?path=${encodeURIComponent(path)}`))).json().catch(() => ({}))) as { preview?: FilePreview }).preview;
		const live = all.filter((one) => LIVE.test(one));
		if (agentId && live.length) {
			const files = [];
			for (const path of live) files.push({ path, preview: await previewOf(path) });
			void editDrawing(agentId, liveFileOps(files, middle, fresh, fromStage));
		}
		const paths = all.filter((one) => !LIVE.test(one));
		if (!agentId || paths.length === 0) return;
		const files = [];
		// Its path from the stage's own folder, as a file's chip in a card has it, so a double-click opens it (`openFileOf`).
		for (const path of paths) files.push({ path: fromStage(path), preview: await previewOf(path) });
		void editDrawing(agentId, fileCardOps(files, middle, fresh, fromStage));
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
				const asset = await uploadAsset(file, (fraction) => report.update(`${file.name} · ${Math.round(fraction * 100)}% of ${sizeLabel(file.size)}`), stageOnScreen());
				if (isRaster(file)) ops.push({ op: "insert", parent: into.card, index: into.index + ops.length, node: cardPicture(file.name, fromStage(asset.path), into.inner, natural) });
				else ops.push({ op: "insert", parent: into.card, index: into.index + ops.length, node: fileItem(fromStage(asset.path), none) });
			} catch (error) {
				failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		if (ops.length) void editDrawing(agentId, ops);
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
		const items: DroppedItem[] = [];
		const failures: string[] = [];
		for (const [index, file] of files.entries()) {
			const of = files.length > 1 ? `${index + 1} of ${files.length} · ` : "";
			try {
				if (isWords(file)) {
					items.push(wordsCard(file.name, await file.text()));
					continue;
				}
				const natural = (await naturalSize(file)) ?? { width: 480, height: 360 };
				const asset = await uploadAsset(file, (fraction) => report.update(`${of}${file.name} · ${Math.round(fraction * 100)}% of ${sizeLabel(file.size)}`), stageOnScreen());
				// Only a file named as a film or a sound: ffmpeg reads a still picture as a one-frame film.
				if (asset.media && isPlayable(file)) items.push(mediaItem(file.name, asset.path, asset.media, fromStage, natural));
				else items.push(pictureItem(file.name, fromStage(asset.path), natural));
			} catch (error) {
				failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		if (items.length > 0) {
			const stamp = Date.now().toString(36);
			void editDrawing(agentId, rowOps(items, middle, (i) => `drop-${stamp}-${i}`));
		}
		const added = items.length === 0 ? "" : `${items.length === 1 ? files[0]?.name : `${items.length} files`} put on the canvas`;
		report.done([added, ...failures].filter(Boolean).join(" · ") || undefined, failures.length > 0 ? "warn" : "info");
	};

	/**
	 * Files on the clipboard: on the canvas, in the middle of the view, as a drop there would put them.
	 *
	 * Never into a board, whatever is selected: nothing is pasted or dropped into a board's page. A
	 * paste while something is focused belongs to that thing — the composer, a field — so a
	 * screenshot pasted into a sentence you are writing is not put on the canvas.
	 */
	const paste = (files: File[]) => {
		if (files.length === 0 || refusedOn(stageOnScreen())) return;
		const stage = document.querySelector(".stage, iframe.canvas-frame");
		if (!stage) return;
		void onEmptyCanvas(files, { x: stage.clientWidth / 2, y: stage.clientHeight / 2 });
	};

	/**
	 * A file put on the canvas from the File button, centred where it was asked for. It is chosen in
	 * the picker — anything in the deck or a root it declares, a file from this device copied in, or
	 * a Google Doc — and placed by what it is: a document opens as a page edited where it is, a
	 * picture, a film or a sound is an item on the canvas itself, and anything else (a PDF, a web
	 * page, a spreadsheet) a file card, as a dropped file is. Answers the document item made, if any.
	 * `aimed` is false from the toolbar's button, which names no point: a document then goes beside
	 * the newest thing on the canvas rather than on whatever is in the middle of the screen.
	 */
	const fileAt = async (at: { x: number; y: number }, aimed = true): Promise<string | undefined> => {
		const stage = document.querySelector(".stage, iframe.canvas-frame");
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
			// A Google Doc comes back from the picker as `google:<address>`; the server links it before it makes the item.
			return askFor((request) =>
				send({
					type: "document.create",
					...(google ? { google } : { document: picked }),
					...(aimed ? { at: { x: Math.round(middle.x - size.w / 2), y: Math.round(middle.y - size.h / 2) } } : {}),
					request,
				}),
			);
		}
		const agentId = state.focused;
		// In the deck, the stage file refers to it where it is, with nothing copied: the server says where that is, and what a film or a sound is.
		const where = (await (await fetch(api(`/where?path=${encodeURIComponent(picked)}`))).json().catch(() => ({ inDeck: false }))) as { inDeck: boolean; path?: string; media?: { kind: "video" | "audio"; poster?: string; peaks?: number[]; seconds?: number; w?: number; h?: number } };
		const inDeck = where.inDeck && !!where.path;
		const deckPath = where.path ?? picked;
		const place = (item: SizedItem) => {
			if (agentId) void editDrawing(agentId, [centredOp(item, middle, `file-${Date.now().toString(36)}`)]);
		};
		const name = picked.split("/").pop() ?? picked;
		if (inDeck && RASTER.has(extension)) {
			const natural = await new Promise<{ width: number; height: number }>((resolve) => {
				const image = new Image();
				image.onload = () => resolve({ width: image.naturalWidth || 480, height: image.naturalHeight || 360 });
				image.onerror = () => resolve({ width: 480, height: 360 });
				void authedSrc(api(`/file?path=${encodeURIComponent(deckPath)}`)).then(
					(src) => (image.src = src),
					() => resolve({ width: 480, height: 360 }),
				);
			});
			place(pictureItem(name, fromStage(deckPath), natural));
			return undefined;
		}
		if (inDeck && PLAYABLE.has(extension)) {
			const facts = where.media;
			if (facts) {
				place(mediaItem(name, deckPath, facts, fromStage));
				return undefined;
			}
		}
		// Anything else in the deck (a PDF, a web page, an SVG): a file card or an item on the canvas, the file used where it is.
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

	/** A document asked for from the picker heard its item's path — see `document.created` in the frame switch. */
	const hearCreated = (request: string, path: string): boolean => {
		const waiting = created.get(request);
		if (!waiting) return false;
		created.delete(request);
		waiting(path);
		return true;
	};

	/**
	 * The two document-wide listeners: a paste, and a drop on the canvas.
	 *
	 * Both are on the document because both can land anywhere — over the rail, over the
	 * conversation, in the gap between boards — and a drop the app does not handle would be
	 * the browser opening the file, which unloads the app: socket, camera and all.
	 */
	const install = (deps: { preview(): unknown; /** A copy of canvas items, or words, handed to the canvas (its frame's `clipboard.ts`); false when there is no canvas to take it. */ forward?(data: { clip?: string; text?: string }): boolean }) => {
		onMount(() => {
			const onPaste = (event: ClipboardEvent) => {
				// `closest` is asked for rather than assumed: a paste with nothing focused
				// targets the document, which is not an element.
				const target = event.target as HTMLElement | null;
				if (target?.closest?.("input, textarea, [contenteditable]")) return;
				const files = Array.from(event.clipboardData?.files ?? []);
				if (files.length === 0) {
					// Items copied on a canvas, or words: the canvas's, as a paste with the focus in it would be.
					const clip = event.clipboardData?.getData("application/x-decks-clip") || event.clipboardData?.getData("text/html") || "";
					const text = event.clipboardData?.getData("text/plain") ?? "";
					const isClip = clip.includes('"v":1') || clip.includes("decks-clip");
					if ((!isClip && !text.trim()) || !deps.forward) return;
					if (deps.forward({ ...(isClip ? { clip } : {}), text })) event.preventDefault();
					return;
				}
				event.preventDefault();
				paste(files);
			};
			document.addEventListener("paste", onPaste);
			onCleanup(() => document.removeEventListener("paste", onPaste));
		});

		/*
		 * Every file dropped on the canvas reaches here — on empty canvas, and over a board too: a
		 * board's page hands its drop back to be replayed on its frame (`embed-guest.js`), since nothing
		 * is dropped into a board. The input bar takes its own. The files land where they were dropped.
		 */
		onMount(() => {
			dropPreview = deps.preview;
			onCleanup(guardDocumentDrops(document, dropAt));
		});
	};
	let dropPreview: () => unknown = () => undefined;
	/** Files dropped at a point of the window: on the canvas here, or handed over by the canvas frame (`frame/`). */
	const dropAt = (at: { x: number; y: number }, files: File[], card?: { card: string; index: number; inner: number }) => {
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
		if (dropPreview()) {
			notice("info", "That is the canvas as it used to be. Let go of the timeline first.");
			return;
		}
		if (files.length > 0) void onEmptyCanvas(files, at, card);
	};

	return { addFile, intoComposer, paste, fileAt, hearCreated, install, dropAt };
}
