import { baseTheme, CLIP_TYPE, clipFromHtml, clipHtml, clipItems, clipText, ids as idsOf, isArrow, parseClip, pastedItems, placements, walk, type Clip, type PenNode } from "@decks/pen";
import { toWorld } from "../../camera/camera.ts";
import type { CanvasHandle } from "../../types.ts";

/**
 * Copy, cut and paste of the canvas's items, in the canvas frame.
 *
 * ⌘C puts a clip on the clipboard (`@decks/pen`'s `Clip`): the selected items whole, their canvas and
 * place, and who keeps the canvas, as its own type, inside the `text/html` (where a custom type does
 * not survive) and as words for other apps. On a harness the harness holds the copy too
 * (`canvas.clip`), read off its drawing, and a paste on any canvas of that harness is one call
 * (`canvas.paste`), which copies the files the items need. On Studio a paste puts in, with ids of its
 * own, what needs no file; a picture or an HTML card is refused with why, since Studio cannot copy
 * their files from one canvas to another. ⌘X is a copy, then the items taken off.
 *
 * Nothing here while you type in a text or a card, or have words selected: those are the browser's.
 * Files from the computer go to the page, which uploads them where the pointer is (`upload`); words
 * from elsewhere become a note.
 */
export interface ClipboardDeps {
	handle: CanvasHandle;
	canvas: string;
	/** Who keeps the canvas: the harness's id, or `studio:<address>`. */
	harness: () => string;
	canWrite: () => boolean;
	/** The harness's calls, on the canvas's pass; none on Studio. */
	call?: (verb: string, args: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string; notes?: string[] }>;
	upload: (files: File[], at: { x: number; y: number }) => void;
	say: (text: string) => void;
}

/** A clip's id: random enough that no one guesses another's. */
const freshId = () => {
	const bytes = crypto.getRandomValues(new Uint8Array(18));
	return `c${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("")}`;
};

/** Whether the focus is somewhere you type: a field, a text being edited, a card's own, inside shadow roots too. */
function typing(): boolean {
	let at: Element | null = document.activeElement;
	while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement;
	return !!at && (at.matches("input, textarea, select") || (at as HTMLElement).isContentEditable);
}

/** Words selected on the page (in a card, a note): a copy of those is the browser's. */
function wordsSelected(): boolean {
	const selection = getSelection();
	return !!selection && !selection.isCollapsed && selection.toString().trim() !== "";
}

/** Whether an item needs a file copied to land on another canvas: a card or a board, a picture, a film, a file piece. */
function needsFiles(node: PenNode, sameCanvas: boolean): string | undefined {
	const meta = (node.metadata ?? {}) as Record<string, unknown>;
	if (node.type === "browser" && (meta.type === "decks.card" || meta.type === "decks.board")) return "an HTML card";
	if (sameCanvas) return undefined;
	if (node.type === "browser" && meta.type === "decks.document") return "a document";
	let picture = false;
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) value.forEach(visit);
		else if (value && typeof value === "object")
			for (const [key, inner] of Object.entries(value)) {
				if (key === "children" || key === "metadata") continue;
				if (key === "url" && typeof inner === "string" && !/^(?:https?|data|blob):/i.test(inner)) picture = true;
				else visit(inner);
			}
	};
	visit(node);
	if (picture) return "a picture";
	if (!isArrow(node) && ["path", "file", "poster"].some((key) => typeof meta[key] === "string" && (meta[key] as string).includes("/"))) return "a file";
	return undefined;
}

export function installClipboard(deps: ClipboardDeps): { paste: (data: { clip?: string; text?: string }) => void } {
	const { handle } = deps;
	/** Where the pointer is over the canvas, on this frame's screen; undefined once it has left. */
	let pointer: { x: number; y: number } | undefined;
	addEventListener("pointermove", (event) => (pointer = { x: event.clientX, y: event.clientY }), true);
	document.documentElement.addEventListener("pointerleave", () => (pointer = undefined));
	const view = () => ({ width: innerWidth, height: innerHeight });
	const screenAt = () => pointer ?? { x: innerWidth / 2, y: innerHeight / 2 };
	const worldAt = () => {
		const at = toWorld(handle.camera(), view(), screenAt());
		return { x: Math.round(at.x), y: Math.round(at.y) };
	};

	const copy = (event: ClipboardEvent, cut: boolean) => {
		if (event.defaultPrevented || !event.clipboardData || typing() || wordsSelected()) return;
		const ids = handle.selection?.() ?? [];
		if (!ids.length) return;
		const doc = handle.drawn();
		const taken = clipItems(doc, ids, placements(doc, { theme: baseTheme(doc, "light") }));
		if (!taken) return;
		const id = deps.call ? freshId() : undefined;
		const clip: Clip = { v: 1, harness: deps.harness(), canvas: deps.canvas, ...(id ? { id } : {}), box: taken.box, items: taken.items };
		const text = clipText(taken.items);
		event.preventDefault();
		event.clipboardData.setData(CLIP_TYPE, JSON.stringify(clip));
		event.clipboardData.setData("text/html", clipHtml(clip, text));
		event.clipboardData.setData("text/plain", text);
		// The items the copy took, by their ids here: what a cut takes off.
		const tops = taken.items.map((item) => item.id);
		const takeOff = () => {
			if (cut && deps.canWrite()) handle.edit(tops.map((one) => ({ op: "delete", id: one })));
		};
		if (!deps.call || !id) return takeOff();
		// The harness holds the copy before a cut takes the items off: what it holds is read off the drawing.
		void deps.call("canvas.clip", [ids, { id }]).then((answer) => {
			if (answer.ok) return takeOff();
			deps.say(`The copy was not made: ${answer.error ?? "the harness did not answer"}`);
		});
	};
	addEventListener("copy", (event) => copy(event, false));
	addEventListener("cut", (event) => copy(event, true));

	/** Select what a paste put in, once the drawing has it (it comes down the canvas's stream). */
	const selectWhenDrawn = (made: string[], tries = 40) => {
		if (!made.length) return;
		const here = new Set(idsOf(handle.drawn()));
		if (made.every((one) => here.has(one)) || tries <= 0) return handle.select(made.filter((one) => here.has(one)));
		setTimeout(() => selectWhenDrawn(made, tries - 1), 50);
	};

	const pasteClip = async (clip: Clip) => {
		const at = worldAt();
		if (deps.call) {
			const answer = await deps.call("canvas.paste", [{ v: 1, id: clip.id, canvas: clip.canvas }, { at }]);
			if (!answer.ok) return deps.say(answer.error ?? "Nothing was pasted.");
			if (answer.notes?.length) deps.say(answer.notes.join(" "));
			return selectWhenDrawn(((answer.value ?? []) as Array<{ id?: string }>).map((one) => one.id).filter((one): one is string => !!one));
		}
		// Studio: what needs no file, put in here with ids of its own.
		const same = clip.canvas === deps.canvas;
		const needing = [...new Set(clip.items.flatMap((item) => [...walk([item])].map((one) => needsFiles(one, same)).filter((one): one is string => !!one)))];
		if (needing.length) return deps.say(`Not pasted: ${needing.join(", ")} needs its files copied to this canvas, which Studio cannot do yet. Copy notes, shapes, text, arrows and markdown cards on their own, or paste on the harness.`);
		const pasted = pastedItems(clip.items, new Set(idsOf(handle.drawn())), { dx: at.x - clip.box.x, dy: at.y - clip.box.y });
		handle.edit(pasted.items.map((node) => ({ op: "insert", node })));
		handle.select(pasted.items.map((one) => one.id));
	};

	const paste = (data: { clip?: Clip | undefined; text?: string | undefined }) => {
		if (!deps.canWrite()) return deps.say("This canvas can only be read, so nothing is pasted on it.");
		if (data.clip && data.clip.harness === deps.harness() && (data.clip.id || !deps.call)) return void pasteClip(data.clip);
		const words = (data.clip ? clipText(data.clip.items) : data.text ?? "").trim();
		if (!words) return;
		const at = worldAt();
		const id = `pasted-${Date.now().toString(36)}`;
		handle.edit([{ op: "insert", node: { type: "note", id, content: words.slice(0, 20_000) }, box: { x1: at.x, y1: at.y } }]);
		selectWhenDrawn([id]);
	};

	addEventListener("paste", (event) => {
		if (event.defaultPrevented || !event.clipboardData || typing()) return;
		const files = Array.from(event.clipboardData.files ?? []);
		if (files.length) {
			event.preventDefault();
			if (!deps.canWrite()) return deps.say("This canvas can only be read, so nothing is pasted on it.");
			return deps.upload(files, screenAt());
		}
		const clip = parseClip(event.clipboardData.getData(CLIP_TYPE)) ?? clipFromHtml(event.clipboardData.getData("text/html"));
		const text = event.clipboardData.getData("text/plain");
		if (!clip && !text.trim()) return;
		event.preventDefault();
		paste({ clip, text });
	});

	// A paste the page heard while it had the focus, handed over (`PageToFrame.paste`).
	return { paste: (data) => paste({ clip: parseClip(data.clip) ?? clipFromHtml(data.clip), text: data.text }) };
}

/** A line at the foot of the frame for a moment: why a copy or a paste did nothing. */
export function sayer(root: HTMLElement): (text: string) => void {
	let shown: HTMLElement | undefined;
	let hide: ReturnType<typeof setTimeout> | undefined;
	return (text) => {
		shown?.remove();
		clearTimeout(hide);
		const line = document.createElement("div");
		line.className = "frame-said";
		line.setAttribute("role", "status");
		line.textContent = text;
		line.style.cssText = "position:fixed;left:50%;bottom:calc(var(--frame-dock, 0px) + 24px);transform:translateX(-50%);max-width:min(560px,90vw);padding:8px 14px;border-radius:10px;background:var(--panel,#222);color:var(--fg,#fff);border:1px solid var(--line-strong,#8886);box-shadow:0 6px 24px #0003;font:13px/1.4 var(--font-sans,system-ui);z-index:50;pointer-events:none";
		root.append(line);
		shown = line;
		hide = setTimeout(() => line.remove(), 5000);
	};
}
