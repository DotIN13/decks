import { onCleanup, onMount } from "solid-js";
import type { BoardPatch } from "@decks/protocol";
import { toWorld } from "../camera/camera.ts";
import { camera } from "../state/camera.ts";
import { flow, guardDocumentDrops, isImage, shapeFor, type FileDropHost } from "../canvas/file-drop.ts";
import type { EditorHost } from "../canvas/Editor.ts";
import { state } from "../state/deck.ts";
import { notice, working } from "../state/notices.ts";
import { selected } from "../state/selection.ts";
import { send } from "../state/socket.ts";
import { setDraft } from "../state/ui.ts";
import { embedPath, uploadAsset } from "./upload.ts";

/** The heading a board made by a drop starts under, and where its first row sits. */
const FIRST_ROW = 152;

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
				inserts.push({
					op: "insert",
					// `image` and `embed` render the same markup; the kind is what names the
					// component, so `image-1` in the file says what it is without opening it.
					kind: isImage(file) ? "image" : "embed",
					id: "",
					at: boxes[index]!,
					embed: embedPath(path, asset.path),
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
	 * The other end of the file picker (`canvas/FilePicker.tsx`), and the whole of "getting a
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
	 * Files dropped on empty canvas: a board of their own, centred where they landed.
	 *
	 * Laid out first, the same way a drop on a board is (`flow`), under the heading a new board
	 * comes with, so the board can be asked for at the size that holds them. Then made, placed,
	 * and filled through the ordinary drop path — one upload and one insert per file.
	 */
	const onEmptyCanvas = async (files: File[], at: { x: number; y: number }) => {
		const stage = document.querySelector(".stage");
		if (!stage) return;
		const shapes = await Promise.all(files.map(shapeFor));
		const width = Math.min(1200, Math.max(880, Math.max(...shapes.map((shape) => shape.width)) + 96));
		const boxes = flow(shapes, { x: 48, y: FIRST_ROW }, width);
		const height = Math.max(400, Math.max(...boxes.map((box) => box.top + box.height)) + 48);
		// `at` is already in stage pixels: the stage is the viewport (`camera/coords.ts`).
		const middle = toWorld(camera(), { width: stage.clientWidth, height: stage.clientHeight }, at);
		const request = `drop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const path = await new Promise<string | undefined>((resolve) => {
			created.set(request, resolve);
			send({
				type: "board.create",
				kind: "blank",
				format: "component",
				title: files.length === 1 ? files[0]!.name : `${files.length} files`,
				size: { w: width, h: height },
				at: { x: Math.round(middle.x - width / 2), y: Math.round(middle.y - height / 2) },
				request,
			});
			setTimeout(() => {
				if (created.delete(request)) resolve(undefined);
			}, 10_000);
		});
		if (!path) {
			notice("warn", "The board for that file was not made. Try dropping it again.");
			return;
		}
		await dropOnBoard(path, files, { x: 48, y: FIRST_ROW });
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
			notice("info", "Pick a board first. A pasted file becomes an embed, and an embed lives on a board.");
			return;
		}
		if (!deps.editor.enabled()) {
			notice("info", "Zoom in until the board is live, then paste.");
			return;
		}
		void dropOnBoard(board.path, files, { x: board.w / 2, y: board.h / 2 });
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
					const over = document.elementFromPoint(at.x, at.y)?.closest(".board-node");
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

	return { drops, addFile, intoComposer, paste, hearBoard, install };
}
