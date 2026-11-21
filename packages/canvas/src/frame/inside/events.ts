import { life } from "./life.ts";
import { m } from "@decks/i18n";
import { serialize } from "@decks/pen";
import { untrack } from "solid-js";
import { touchedBy } from "./marks.ts";
import type { Camera } from "@decks/protocol";
import { setDrawing } from "../../ink/ink.ts";
import { useInsets } from "../../camera/insets.ts";
import { drawingFollower } from "./backend.ts";
import { installClipboard, sayer } from "./clipboard.ts";
import type { FrameContext } from "./boot.ts";
import { followLine } from "./follow-line.ts";
import { createViewCalls } from "./view-calls.ts";
import { listenToPage } from "./page-events.ts";
import { mirrorTools } from "../tools-mirror.ts";
import { probes } from "../../base/debug.ts";

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
	const say = sayer(root);
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
		say,
	});
	// A sheet open over the foot of the frame (a phone's properties drawer): the page's dock makes way for it.
	document.addEventListener("decks-sheet", (event) => end.emit("sheet", { open: !!(event as CustomEvent<{ open?: boolean }>).detail?.open }), { signal: life() });
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
		edits: (edits, base, made, author) => {
			// A deleted item's box is gone once the edits are in: read first.
			const agent = author?.kind === "agent" && author.id ? author : undefined;
			const before = new Map<string, ReturnType<typeof handle.itemBox>>();
			if (agent) for (const edit of edits) if (edit.op === "remove") before.set(edit.id, handle.itemBox(edit.id));
			const applied = handle.applyEdits(edits, base, made) !== false;
			changed();
			/*
			 * An agent's edit is shown as its hand: a mark in its colour on each thing it touched, and its
			 * cursor going to each in turn (`marks.ts`, `presence.ts`). Read from the change itself rather
			 * than the agent's act, so the marks land with the drawing and a run of edits is one tour.
			 */
			if (applied && agent) {
				const who = ctx.agents()[agent.id!];
				const color = who?.color ?? "#3b5cf6";
				const touched = touchedBy(edits, (id) => before.get(id), (id) => handle.itemBox(id));
				ctx.marks.add(agent.id!, color, touched);
				ctx.presence?.tour(agent.id!, { kind: "agent", id: agent.id!, name: who?.name ?? agent.name ?? m.canvas_presence_agent(), color }, touched.map((one) => ({ x: one.box.x, y: one.box.y })));
			}
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

	/**
	 * Select a card by its path, as a press on it does: the card itself, and nothing in the drawing's
	 * own selection. An agent's `view focus`, a row of the side panel and a canvas opened again all come
	 * here. They used to put the card in the drawing's selection instead, which is what the properties
	 * panel shows for, so every card an agent placed and flew to came with its position, size and
	 * corners in a panel over the canvas, where a press on a card never opens one.
	 */
	let selecting: ReturnType<typeof setTimeout> | undefined;
	const selectCard = (path: string | undefined, until = Date.now() + 2000) => {
		clearTimeout(selecting);
		if (!path) return;
		const children = (handle.drawn().children ?? []) as unknown as Array<{ id?: string; metadata?: { path?: string } }>;
		/*
		 * An app's window or a document has no file path of its own: the page names it `item:<id>`
		 * (`model/drawing.ts`, `pagePath`), and it is found by that id. Looked for by a card's path it was
		 * never found, so the Apps tab's Show on canvas flew to a window and left it unselected.
		 */
		const found = path.startsWith("item:") ? (children.some((one) => one.id === path.slice(5)) ? path : undefined) : children.find((one) => one.metadata?.path === path || path.endsWith(one.metadata?.path ?? "\u0000"))?.metadata?.path;
		if (found) return handle.select([], found);
		// Not on the drawing yet: an item the page has just had placed is selected when its edit arrives, within a moment.
		if (Date.now() < until) selecting = setTimeout(() => selectCard(path, until), 150);
	};
	life().addEventListener("abort", () => clearTimeout(selecting), { once: true });
	// The card the page had selected on this canvas when the frame was made again (an agent switch and back).
	selectCard(start.selected);
	const moveTo = (to: Camera, animate?: boolean) => (animate ? handle.glide(to, 400) : handle.setCamera(to));
	const { viewCall } = createViewCalls({ pages, agent, start, moveTo, ctx, selectCard, end, handle, backend });
	followLine({ studio, handle, changed, first, ctx, backend, viewCall, pages, setPages, follower });
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
	end.on("step", (data) => (data.direction === "undo" ? handle.undo() : handle.redo()));
	end.on("fit", () => handle.fit());
	// The page draws the tools: their state is the same here and there (`tools-mirror.ts`), until this canvas ends.
	if (start.look.pageTools) life().addEventListener("abort", mirrorTools("frame", end, { frame: { zoom: () => ctx.camera().zoom, drawn: () => (ctx.revision(), handle.drawn()) } }), { once: true });
	end.on("camera", (data) => (data.glide ? handle.glide(data.camera, data.glide) : handle.setCamera(data.camera)));
	end.on("select", (data) => {
		// Whatever the page says next is what holds: a selection still being waited for is let go of.
		clearTimeout(selecting);
		if (data.page) selectCard(data.page);
		else handle.select(data.ids);
	});
	end.on("busy", (data) => setBusy({ ...untrack(busy), ...data }));
	end.answer("edit", (data) => {
		probes.pageEdited?.();
		handle.edit(data.ops);
		return true as const;
	});

	listenToPage({ end, pageKeys: start.look.pageKeys, pageKeysFirst: start.look.pageKeysFirst, pageTools: start.look.pageTools });
	return { reread };
}
