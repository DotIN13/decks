/**
 * Things dragged or pasted onto the canvas that are not files: a clip out of a board (`runtime/lib/
 * board.js`), HTML or text from another app. The converter (`core/clip.ts`) says what each becomes;
 * this is the page's half: the preview while a drag is over the canvas, the drop, the paste, and
 * the pictures placed next to the canvas before the one `canvas.batch` that puts it all down.
 *
 * A board is a separate document, so a drag that starts in one sends its `dragover` and `drop` to
 * whichever document is under the pointer: here when that is the canvas, the board's own when it is
 * a board, which refuses a clip (`board.js`). Drag data is sealed until the drop, so the board also
 * leaves the clip on this window (`__decksClip`) for the preview to read.
 *
 * Files are not handled here: `app/files.ts` takes them, as it always has.
 */
import { clipOptions, CLIP_MIME, landingOf, landOps, partsOfClip, partsOfHtml, partsOfText, picturesOf, readClip, type Clip, type IntoCard, type LandOptions, type Part, type Picture, type Placed, type Tree } from "../core/clip.ts";
import type { Pt, Rect } from "../core/model.ts";

export type ClipHost = {
	/** The stage's element: the drop target, and what the preview is drawn in. */
	element: HTMLElement;
	/** The canvas's zoom: screen pixels per stage pixel. */
	zoom(): number;
	/** A point on the screen as a stage point. */
	worldAt(client: { clientX: number; clientY: number }): Pt;
	/** A stage point as a point on the screen (client coordinates). */
	clientOf(world: Pt): Pt;
	/** The card under a point on the screen, the slot there and the line it is drawn as, in stage pixels. */
	cardAt(client: { clientX: number; clientY: number }): (IntoCard & { box: Rect; line?: Rect | undefined }) | undefined;
	/** The card selected alone, for a paste to go into, at its end. */
	selectedCard(): IntoCard | undefined;
	/** Whether a board (its picture, zoomed out) is under a point: a clip is never dropped on a board. */
	boardAt(client: { clientX: number; clientY: number }): boolean;
	/** Whether the person can change the drawing here. */
	editable(): boolean;
	/** A picture placed next to the canvas: copied in when it lives outside the deck. */
	place(picture: Picture): Promise<Placed | undefined>;
	/** One edit: one `canvas.batch`, one step of undo. */
	edit(ops: unknown[]): void;
	/** An id for the new item, free on the stage. */
	freshId(): string;
	/** Where the pointer last was over the canvas, if it still is. */
	pointer(): { clientX: number; clientY: number } | undefined;
	notice?(text: string): void;
};

/** What a drag carries that this takes: a board's clip, or words from another app (never files). */
function carried(transfer: DataTransfer | null): "clip" | "words" | undefined {
	const types = Array.from(transfer?.types ?? []);
	if (types.includes(CLIP_MIME)) return "clip";
	if (types.includes("Files")) return undefined;
	if (types.includes("text/html") || types.includes("text/plain")) return "words";
	return undefined;
}

/** The clip a board left for the drag in progress (`board.js`, `share`). */
const sharedClip = (): Clip | undefined => (globalThis as { __decksClip?: Clip }).__decksClip;

/** HTML from the clipboard or a drag, as the converter's tree. */
export function htmlTrees(html: string): Tree[] {
	const doc = new DOMParser().parseFromString(html, "text/html");
	return Array.from(doc.body.childNodes).flatMap((node) => {
		const tree = treeOfNode(node);
		return tree === undefined ? [] : [tree];
	});
}
const SKIP = new Set(["script", "style", "meta", "link", "head", "title", "template", "noscript", "button", "select", "textarea", "iframe", "object"]);
function treeOfNode(node: Node): Tree | undefined {
	if (node.nodeType === Node.TEXT_NODE) return (node as Text).data;
	if (node.nodeType !== Node.ELEMENT_NODE) return undefined;
	const el = node as Element;
	const t = el.tagName.toLowerCase();
	if (SKIP.has(t) || el.hasAttribute("hidden")) return undefined;
	const a: Record<string, string> = {};
	for (const name of ["href", "src", "alt", "class", "start", "width", "height"]) {
		const value = el.getAttribute(name);
		if (value) a[name === "width" ? "w" : name === "height" ? "h" : name] = value;
	}
	if (t === "pre") {
		const lang = el.getAttribute("data-lang") ?? /(?:^|\s)lang(?:uage)?-([\w+#-]+)/.exec(`${el.querySelector("code")?.className ?? ""} ${el.className}`)?.[1];
		if (lang) a.lang = lang;
		return { t, a, k: [el.textContent ?? ""] };
	}
	if (t === "li") {
		const box = el.querySelector('input[type="checkbox"]');
		if (box) a.task = (box as HTMLInputElement).hasAttribute("checked") ? "x" : " ";
	}
	if (t === "input") return undefined;
	const k = Array.from(el.childNodes).flatMap((child) => {
		const tree = treeOfNode(child);
		return tree === undefined || tree === "" ? [] : [tree];
	});
	return { t, ...(Object.keys(a).length ? { a } : {}), ...(k.length ? { k } : {}) };
}

/** What landed, read once: its parts and how it is sized. */
type Reading = { parts: Part[]; options: LandOptions; grab?: Pt | undefined };

function readClipParts(clip: Clip, zoom: number): Reading {
	return { parts: partsOfClip(clip), options: clipOptions(clip, zoom), grab: clip.grab };
}
function readWords(html: string | undefined, text: string | undefined, plain = false): Reading {
	const parts = !plain && html ? partsOfHtml(htmlTrees(html)) : partsOfText(text ?? "", plain);
	return { parts, options: { k: 1 } };
}

/** Pictures placed, then the parts as one batch. Answers the new item's id when one was made. */
async function land(host: ClipHost, reading: Reading, at: Pt, into: IntoCard | undefined): Promise<string | undefined> {
	const placed = new Map<Picture, Placed | undefined>();
	for (const picture of picturesOf(reading.parts)) placed.set(picture, await host.place(picture).catch(() => undefined));
	const id = host.freshId();
	const ops = landOps(reading.parts, { ...reading.options, at, id, placed: (picture) => placed.get(picture), ...(into ? { into } : {}) });
	if (!ops.length) {
		if (picturesOf(reading.parts).length) host.notice?.("That picture could not be copied next to the canvas.");
		return undefined;
	}
	host.edit(ops);
	return into ? undefined : id;
}

/**
 * The drop, and the preview before it: an outline of what will land, its size on the canvas, with
 * a label naming what it becomes; over a card, the card outlined and the slot among its blocks.
 */
export function attachClipDrop(host: ClipHost): () => void {
	const { element } = host;
	const doc = element.ownerDocument;
	const layer = doc.createElement("div");
	layer.dataset.decksUi = "true";
	layer.className = "clip-preview";
	Object.assign(layer.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "40", overflow: "hidden" });
	const ghost = doc.createElement("div");
	ghost.className = "clip-ghost";
	Object.assign(ghost.style, {
		position: "absolute",
		border: "2px dashed var(--accent, #3b5cf6)",
		borderRadius: "10px",
		background: "color-mix(in srgb, var(--accent, #3b5cf6) 12%, transparent)",
		boxSizing: "border-box",
		display: "none",
	});
	const label = doc.createElement("span");
	Object.assign(label.style, {
		position: "absolute",
		left: "0",
		top: "-26px",
		whiteSpace: "nowrap",
		font: "600 13px/1.2 var(--font-sans, system-ui, sans-serif)",
		color: "#fff",
		background: "var(--accent, #3b5cf6)",
		borderRadius: "999px",
		padding: "4px 10px",
	});
	ghost.appendChild(label);
	const outline = doc.createElement("div");
	outline.className = "clip-card";
	Object.assign(outline.style, { position: "absolute", border: "2px solid var(--accent, #3b5cf6)", borderRadius: "12px", boxSizing: "border-box", display: "none" });
	const slot = doc.createElement("div");
	slot.className = "clip-slot";
	Object.assign(slot.style, { position: "absolute", height: "3px", background: "var(--accent, #3b5cf6)", borderRadius: "2px", display: "none" });
	const slotLabel = label.cloneNode() as HTMLSpanElement;
	slot.appendChild(slotLabel);
	layer.append(outline, slot, ghost);

	let reading: { clip: Clip | undefined; value: Reading } | undefined;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	const hide = () => {
		ghost.style.display = outline.style.display = slot.style.display = "none";
		layer.remove();
		reading = undefined;
	};
	const local = (client: Pt) => {
		const r = element.getBoundingClientRect();
		return { x: client.x - r.left, y: client.y - r.top };
	};

	const onDragOver = (event: DragEvent) => {
		const kind = carried(event.dataTransfer);
		if (!kind || !host.editable()) return;
		event.preventDefault();
		const transfer = event.dataTransfer!;
		if (host.boardAt(event)) {
			transfer.dropEffect = "none";
			hide();
			return;
		}
		transfer.dropEffect = "copy";
		if (!layer.isConnected) element.appendChild(layer);
		clearTimeout(hideTimer);
		// A drag that ends anywhere else (Escape, another window) sends nothing here: the preview goes when the drag stops moving over the canvas.
		hideTimer = setTimeout(hide, 400);
		const clip = kind === "clip" ? sharedClip() : undefined;
		if (!reading || reading.clip !== clip) reading = { clip, value: clip ? readClipParts(clip, host.zoom()) : { parts: [], options: { k: 1 } } };
		const { parts, options, grab } = reading.value;
		const landing = clip ? landingOf(parts, options) : { kind: "text" as const, label: "text or a card", w: 240, h: 48 };
		const card = landing.kind === "none" ? undefined : host.cardAt(event);
		if (card) {
			const a = local(host.clientOf({ x: card.box.x, y: card.box.y }));
			const b = local(host.clientOf({ x: card.box.x + card.box.w, y: card.box.y + card.box.h }));
			Object.assign(outline.style, { display: "block", left: `${a.x - 3}px`, top: `${a.y - 3}px`, width: `${b.x - a.x + 6}px`, height: `${b.y - a.y + 6}px` });
			if (card.line) {
				const s = local(host.clientOf({ x: card.line.x, y: card.line.y }));
				const e = local(host.clientOf({ x: card.line.x + card.line.w, y: card.line.y }));
				Object.assign(slot.style, { display: "block", left: `${s.x}px`, top: `${s.y - 1}px`, width: `${Math.max(8, e.x - s.x)}px` });
			} else slot.style.display = "none";
			slotLabel.textContent = `→ ${landing.kind === "card" ? `blocks in the card (${landing.label.replace("card · ", "")})` : landing.kind === "text" ? "a block in the card" : "a picture in the card"}`;
			ghost.style.display = "none";
			return;
		}
		outline.style.display = slot.style.display = "none";
		const zoom = host.zoom();
		const p = local({ x: event.clientX, y: event.clientY });
		const offset = grab ? { x: grab.x * options.k * zoom, y: grab.y * options.k * zoom } : { x: 10, y: 10 };
		Object.assign(ghost.style, {
			display: landing.kind === "none" ? "none" : "block",
			left: `${p.x - offset.x}px`,
			top: `${p.y - offset.y}px`,
			width: `${Math.max(16, landing.w * zoom)}px`,
			height: `${Math.max(16, landing.h * zoom)}px`,
		});
		label.textContent = `→ ${landing.label}`;
	};

	const onDragLeave = (event: DragEvent) => {
		if (!carried(event.dataTransfer)) return;
		const to = event.relatedTarget as Node | null;
		if (!to || !element.contains(to)) {
			clearTimeout(hideTimer);
			hideTimer = setTimeout(hide, 60);
		}
	};

	const onDrop = (event: DragEvent) => {
		const kind = carried(event.dataTransfer);
		if (!kind) return;
		event.preventDefault();
		event.stopPropagation();
		const shared = sharedClip();
		const cached = reading;
		hide();
		clearTimeout(hideTimer);
		if (!host.editable() || host.boardAt(event)) return;
		const transfer = event.dataTransfer!;
		const clip = kind === "clip" ? (readClip(transfer.getData(CLIP_MIME)) ?? shared) : undefined;
		const value = clip ? (cached?.clip === clip ? cached.value : readClipParts(clip, host.zoom())) : readWords(transfer.getData("text/html"), transfer.getData("text/plain"));
		const world = host.worldAt(event);
		const grab = value.grab;
		const at = grab ? { x: world.x - grab.x * value.options.k, y: world.y - grab.y * value.options.k } : { x: world.x - 10 / host.zoom(), y: world.y - 10 / host.zoom() };
		const card = host.cardAt(event);
		const into = card ? { card: card.card, index: card.index, inner: card.inner } : undefined;
		void land(host, value, at, into);
	};

	element.addEventListener("dragover", onDragOver);
	element.addEventListener("dragleave", onDragLeave);
	element.addEventListener("drop", onDrop);
	return () => {
		element.removeEventListener("dragover", onDragOver);
		element.removeEventListener("dragleave", onDragLeave);
		element.removeEventListener("drop", onDrop);
		clearTimeout(hideTimer);
		hide();
	};
}

/**
 * A paste that is not files: a board's clip, HTML, or text (`plain` for ⇧⌘V). Into the selected card
 * at its end; else under the pointer if it is over the canvas, else in the middle of the screen.
 */
export async function pasteClip(host: ClipHost, data: { clip?: string | undefined; html?: string | undefined; text?: string | undefined; plain?: boolean | undefined }): Promise<boolean> {
	if (!host.editable()) return false;
	const clip = data.plain ? undefined : readClip(data.clip);
	const reading = clip ? readClipParts(clip, host.zoom()) : readWords(data.html, data.text, data.plain);
	if (!reading.parts.length) return false;
	const into = host.selectedCard();
	const pointer = host.pointer();
	let at: Pt;
	if (pointer) at = host.worldAt(pointer);
	else {
		const r = host.element.getBoundingClientRect();
		const middle = host.worldAt({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
		const landing = landingOf(reading.parts, reading.options);
		at = { x: middle.x - landing.w / 2, y: middle.y - landing.h / 2 };
	}
	// What lands is not selected: a card selected takes the next paste, and two pastes in a row are two items.
	await land(host, reading, at, into);
	return true;
}
