import { serialize } from "@decks/pen";
import { untrack } from "solid-js";
import { dismissMenus } from "@decks/ui";
import type { Page, Camera, StageCall } from "@decks/protocol";
import { setDrawing } from "../../edit/ink.ts";
import { useInsets } from "../../camera/insets.ts";
import { runStageCall } from "../../camera/stage-ops.ts";
import { cardShot } from "../../items/card-surface.tsx";
import { handsOn } from "../../camera/touched.ts";
import { drawingFollower } from "./backend.ts";
import { installClipboard, sayer } from "./clipboard.ts";
import type { FrameContext } from "./boot.ts";
import type { CardSlot } from "../protocol.ts";

/**
 * What the frame hears, once its editor is made: the clipboard, the drawing as the harness or Studio
 * changes it, an agent's `decks view …` calls, the page's messages (its look, tools, camera, selection,
 * edits), and the window's own drops, shortcuts and presses. Returns `reread`, which reads the
 * drawing whole again.
 */
export function wireFrame(ctx: FrameContext): { reread: () => void } {
	const { root, start, end, studio, backend, first, pages, setPages, agent, setAgent, busy, setBusy, changed } = ctx;
	const handle = ctx.handle();

	/*
	 * Copy, cut and paste of items (`clipboard.ts`): on a harness through it, which holds the copy and
	 * copies the files a paste needs; on Studio, what needs no file.
	 */
	const harness = studio ? `studio:${start.backend.api}` : ((first as { harness?: string }).harness ?? `harness:${start.backend.api}`);
	const clipboard = installClipboard({
		handle,
		canvas: start.canvas.name,
		harness: () => harness,
		canWrite: ctx.canWrite,
		...(studio ? {} : { call: (verb: string, args: unknown[]) => backend.call(verb, args) }),
		upload: (files, at) =>
			void Promise.all(files.map(async (file) => ({ name: file.name, type: file.type, bytes: await file.arrayBuffer() }))).then((read) =>
				end.call("upload", { files: read, at }, read.map((one) => one.bytes)).catch((error: unknown) => console.warn(error)),
			),
		say: sayer(root),
	});
	end.on("paste", (data) => clipboard.paste(data));

	/*
	 * The drawing as the harness changes it, from its stream: each change is said once per agent on the
	 * canvas, so one already held is passed over, and a gap reads the drawing whole again.
	 */
	let reading = false;
	const follower = drawingFollower({
		whole: (doc, base, made) => {
			handle.setDocument(serialize(doc), base, made);
			changed();
		},
		edits: (edits, base, made) => {
			const applied = handle.applyEdits(edits, base, made) !== false;
			changed();
			return applied;
		},
		reread: () => reread(),
	});
	function reread(): void {
		if (reading) return;
		reading = true;
		void backend
			.drawing()
			.then((now) => {
				follower.at(now.rev);
				handle.setDocument(serialize(now.doc), now.base);
				changed();
			})
			.catch((error: unknown) => console.warn(error))
			.finally(() => (reading = false));
	}
	follower.at(first.rev);

	/** Select a card by its path; `asPress`, as a press on it would, the card itself selected too (what the page restores as a frame starts). */
	const selectCard = (path: string | undefined, asPress = false) => {
		if (!path) return;
		const child = ((handle.drawn().children ?? []) as unknown as Array<{ id?: string; metadata?: { path?: string } }>).find((one) => one.metadata?.path === path || path.endsWith(one.metadata?.path ?? "\u0000"));
		if (child?.id) handle.select([child.id], asPress ? child.metadata!.path : undefined);
	};
	// The card the page had selected on this canvas when the frame was made again (an agent switch and back).
	selectCard(start.selected, true);
	const moveTo = (to: Camera, animate?: boolean) => (animate ? handle.glide(to, 400) : handle.setCamera(to));
	/*
	 * An agent's `decks view …` on this canvas, from the stream: carried out as the page carries it out
	 * for a canvas it holds (`stage-ops.ts`), and answered to the harness.
	 */
	const stageCall = (call: StageCall) => {
		if (call.op === "shot") return void shootCard(call);
		let value: unknown;
		try {
			value = runStageCall(call, {
				boards: () => untrack(pages) as Page[],
				viewport: () => ({ width: innerWidth, height: innerHeight }),
				focused: () => untrack(agent),
				stageOnScreen: () => start.canvas.name,
				setCamera: (to, options) => moveTo(to, options?.animate),
				handsOn,
				offerView: (from, to, selected, what) => ctx.setOffer({ agent: from, what, go: () => {
					moveTo(to, true);
					selectCard(selected);
					ctx.setOffer(undefined);
				} }),
				// Kept by the page with the views it parks (`camera/landing.ts`): it arrives when that chat opens.
				rememberView: (id, to, selected) => end.emit("camera", { camera: to, agent: id, ...(selected ? { selected } : {}) }),
				select: selectCard,
				reload: (path) => handle.reloadCard(path),
				cursor: (at) => ctx.setCursor(at),
			});
		} catch (error) {
			value = { error: error instanceof Error ? error.message : String(error) };
		}
		backend.answer(call.id, value);
	};
	/*
	 * A card as the person has it now, for an agent's `decks canvas screenshot` of it (`stage.call` op
	 * `shot`): its live root written out (`card-snapshot.ts`) and drawn by the harness's Chrome, so the
	 * picture has what they typed, scrolled and drew in it. `none` when the card is not mounted here, and
	 * the harness takes its own picture from the file.
	 */
	const NONE_AFTER = 1500;
	const shootCard = async (call: StageCall) => {
		const path = (call.args as { path?: unknown } | undefined)?.path;
		let value: unknown;
		try {
			const shot = typeof path === "string" ? cardShot(path) : undefined;
			if (typeof path !== "string" || !shot) {
				/*
				 * Said a moment later: the first answer is the one taken, and another tab showing this canvas
				 * may have the card awake.
				 */
				await new Promise((done) => setTimeout(done, NONE_AFTER));
				value = { how: "none", why: "the card is not awake on the person's canvas" };
			} else {
				const drawn = await backend.snapshot(path, shot);
				value = "data" in drawn ? { how: "snapshot", ...drawn } : { how: "none", why: drawn.why };
			}
		} catch (error) {
			value = { how: "none", why: error instanceof Error ? error.message : String(error) };
		}
		backend.answer(call.id, value);
	};
	// On Studio: the drawing as Studio's revisions change it, kept in step as Studio's own page keeps it.
	if (studio)
		studio.follow(
			(doc) => {
				handle.setDocument(serialize(doc));
				changed();
			},
			() => handle.document(),
			first.rev,
		);
	else backend.follow((message) => {
		if (message.type === "stage.call") return stageCall(message.call);
		if (message.type.startsWith("doc.")) return ctx.hearDoc(message);
		// A card's file changed: its record taken, its place kept, as the drawing says it.
		if (message.type === "card.changed") {
			if (message.removed || !message.card) return;
			const record = message.card;
			setPages(untrack(pages).map((page) => (page.path === record.path ? { ...record, x: page.x, y: page.y, w: page.w, h: page.h, trust: page.trust } : page)));
			return;
		}
		follower.hear(message);
	});
	end.on("reload", (data) => handle.reloadCard(data.path));
	end.on("look", (data) => {
		if (data.agent !== undefined && data.agent !== untrack(agent)) setAgent(data.agent);
		if (data.insets) useInsets(data.insets);
		if (data.agents) ctx.setAgents(data.agents);
		if (data.dock !== undefined) {
			ctx.setDock(data.dock);
			ctx.reflect();
		}
		if (data.composer !== undefined) ctx.setComposerBox(data.composer);
		if (data.dark !== undefined) {
			document.documentElement.dataset.colorScheme = data.dark ? "dark" : "light";
			ctx.setDark(data.dark);
			handle.setDark(data.dark);
		}
		if (data.mode !== undefined) handle.setMode(data.mode);
	});
	end.on("tool", (data) => {
		if (data.tool) handle.setTool(data.tool);
		if (data.ink) setDrawing(data.ink.on);
	});
	end.on("camera", (data) => (data.glide ? handle.glide(data.camera, data.glide) : handle.setCamera(data.camera)));
	end.on("select", (data) => (data.page ? selectCard(data.page) : handle.select(data.ids)));
	end.on("busy", (data) => setBusy({ ...untrack(busy), ...data }));
	end.answer("edit", (data) => {
		handle.edit(data.ops);
		return true as const;
	});

	/*
	 * Files dropped from outside the browser: never opened in place (a dropped file's default is to
	 * replace the page with it), but handed to the page, which uploads them into this canvas's folder
	 * and places them where they landed, as it does a drop of its own.
	 */
	const carries = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
	addEventListener("dragover", (event) => {
		if (!carries(event)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
	});
	addEventListener("drop", (event) => {
		if (!carries(event)) return;
		event.preventDefault();
		const at = { x: event.clientX, y: event.clientY };
		// Over a card they go into it, between its blocks where they land: only the stage here knows what is under the point.
		const card = (globalThis as { __decksCardAt?: (x: number, y: number) => CardSlot | undefined }).__decksCardAt?.(at.x, at.y);
		const files = Array.from(event.dataTransfer?.files ?? []);
		void Promise.all(files.map(async (file) => ({ name: file.name, type: file.type, bytes: await file.arrayBuffer() }))).then((read) =>
			end.call("upload", { files: read, at, ...(card ? { card } : {}) }, read.map((one) => one.bytes)).catch((error: unknown) => console.warn(error)),
		);
	});

	/*
	 * A shortcut the canvas did not take goes to the page, so the app's own keys work wherever the focus
	 * is: only one with a modifier, since a bare letter typed here is the canvas's or a card's.
	 */
	addEventListener("keydown", (event) => {
		if (event.defaultPrevented || !(event.metaKey || event.ctrlKey || event.altKey)) return;
		end.emit("keys", { key: event.key, code: event.code, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey });
	});

	/*
	 * A press or Escape here puts away the page's menus, which hear nothing from this document; and one
	 * there puts away this frame's (`@decks/ui` dismiss).
	 */
	addEventListener("pointerdown", () => end.emit("away", {}), true);
	addEventListener("keydown", (event) => event.key === "Escape" && end.emit("away", {}), true);
	end.on("away", () => dismissMenus());
	return { reread };
}
