/**
 * The editor, mounted with no app around it.
 *
 * This page is three things at once, and each is the reason it exists:
 *
 * - **the manual test bed**: a board path in the query, the editor over it, a gesture checked by eye;
 * - **the proof that the package is standalone**: it imports `@decks/editor` and nothing else from
 *   the repo. If the editor needed the canvas, the camera or the socket, this page could not work;
 * - **the differential's subject**: it renders a board and publishes the shape of what it rendered
 *   beside the shape of the browser's own parse of the same bytes, so a check can compare them
 *   without either side guessing (`e2e/checks/render-fidelity.mjs`).
 *
 * It is a *dev* page, served by the app's Vite because Vite is what turns TypeScript into something a
 * browser can run in this repo. Nothing on this page is part of the app.
 */
import { createEditor, parseBoard, serialize, shapeOf, type Editor, type TreeNode } from "@decks/editor";

const params = new URLSearchParams(location.search);
const path = params.get("board") ?? "boards/plan.html";
const base = `/api/board/${path.split("/").slice(0, -1).join("/")}/`;
/**
 * `?frame=0` compares without rendering into a frame at all.
 *
 * The shape comparison is of two strings — our serialisation and the file — handed to the same
 * parser, so it needs no iframe, no board script, and no network. That matters at scale: over the
 * whole deck, 550 boards each running `board.js` and fetching whatever their embeds point at took
 * the tab down. The handles check *does* need the frame, so it is the default mode and the deck-wide
 * run turns it off.
 */
const withFrame = params.get("frame") !== "0";

/** What the check reads, and what a person watches. */
const report = {
	path,
	loaded: false,
	/**
	 * True when our render parsed to the same shape as the browser's parse of the file.
	 *
	 * Taken *before the board's scripts draw*, which is the point: after `board.js` has drawn a panel
	 * the DOM is allowed to differ, because a drawn panel is not the file.
	 */
	equal: false,
	diff: "",
	shapes: { rendered: "", expected: "" },
	/** How many nodes there are, and how many of them found their element in the frame. */
	handles: { nodes: 0, landed: 0 } as { nodes: number; landed: number } | null,
	ops: [] as unknown[],
	/** The selection, as much as a person or a check needs: where, what kind, and a projection's source. */
	selection: null as { path: number[]; kind: string; id?: string; source?: string } | null,
};

declare global {
	interface Window {
		__editorDev?: typeof report;
	}
}
window.__editorDev = report;

const host = document.querySelector("#editor") as HTMLElement;
const out = document.querySelector("#ops") as HTMLElement;
const status = document.querySelector("#said") as HTMLElement;
/**
 * The mode control, and the reason it is a button.
 *
 * A key would be the app's to bind, and in the app it is: the mode arrives as a getter over the app's
 * own signal. Here it is the page's, and it has to be pressable from outside — a check that has to
 * guess where focus is before it can flip a mode is a check that fails for the wrong reason. Measured:
 * a press inside the frame leaves focus in the frame, and `e` pressed on the page never arrives.
 */
const modeButton = document.querySelector("#mode") as HTMLButtonElement;

/** Every node in the tree. */
function countNodes(node: TreeNode): number {
	let total = 1;
	for (const part of node.parts) if (part.kind === "element") total += countNodes(part.node);
	return total;
}

/** Every node whose element was found in the rendered frame. */
function countElements(node: TreeNode): number {
	let total = node.element ? 1 : 0;
	for (const part of node.parts) if (part.kind === "element") total += countElements(part.node);
	return total;
}

/** The first place two shapes part company, with a little context on each side. */
function firstDifference(a: string, b: string): string {
	let at = 0;
	while (at < a.length && at < b.length && a[at] === b[at]) at++;
	const window_ = 90;
	return `at ${at}\n  ours:   …${a.slice(Math.max(0, at - 20), at + window_)}\n  theirs: …${b.slice(Math.max(0, at - 20), at + window_)}`;
}

async function main(): Promise<void> {
	const response = await fetch(`/api/board/${path}?raw=1`);
	if (!response.ok) {
		status.textContent = `could not read ${path}: ${response.status}`;
		return;
	}
	const source = await response.text();

	/*
	 * The frame is ours: an iframe with no `src`, whose document the editor writes.
	 *
	 * No `sandbox` attribute, deliberately — the board's own scripts have to run for a panel to draw,
	 * exactly as they do in the board's own frame, which has none either.
	 */
	if (!withFrame) {
		// No frame: parse, serialise, parse both, compare. The pure half of the check.
		const expected = shapeOf(new DOMParser().parseFromString(source, "text/html"));
		const ours = shapeOf(new DOMParser().parseFromString(serialize(parseBoard(source), { base }), "text/html"));
		report.shapes = { rendered: ours, expected };
		report.equal = ours === expected;
		report.diff = report.equal ? "" : firstDifference(ours, expected);
		report.handles = null;
		report.loaded = true;
		status.textContent = report.equal ? `shape matches — ${path}` : `shape differs — ${path}`;
		status.dataset.state = report.equal ? "ok" : "bad";
		return;
	}

	const frame = document.createElement("iframe");
	frame.className = "board-frame";
	frame.setAttribute("title", path);
	host.append(frame);

	let editor: Editor | undefined;
	editor = createEditor(frame, {
		source,
		base,
		mode: () => (document.documentElement.dataset.mode === "edit" ? "edit" : "browse"),
		onRendered: () => {
			if (!editor) return;
			/*
			 * The shape is taken of **strings parsed twice**, not of the live frame.
			 *
			 * That is not a shortcut, it is the only honest moment. By the time the frame has loaded,
			 * the board's own script has already run — measured, it injects a stylesheet and two
			 * scripts of its own into the head — so the frame's DOM is the *rendered* board, which is
			 * what it should be and is exactly what must not be compared. What we are checking is our
			 * own serialisation: hand it and the file's source to the same parser and compare.
			 */
			const expected = shapeOf(new DOMParser().parseFromString(source, "text/html"));
			const rendered = serialize(editor.tree, { base });
			const ourShape = shapeOf(new DOMParser().parseFromString(rendered, "text/html"));
			report.shapes = { rendered: ourShape, expected };
			report.equal = ourShape === expected;
			report.diff = report.equal ? "" : firstDifference(ourShape, expected);

			// And separately: did every handle find the element it was stamped on? That is the frame's
			// job, and the frame is what the scripts have been changing.
			const nodes = countNodes(editor.tree.root);
			const landed = countElements(editor.tree.root);
			report.handles = { nodes, landed };
			report.loaded = true;
			status.textContent = report.equal
				? `shape matches — ${path} · handles ${landed}/${nodes}`
				: `shape differs — ${path}`;
			status.dataset.state = report.equal && landed === nodes ? "ok" : "bad";
			if (!report.equal) console.warn("shape differs:", report.diff);
		},
		onSelect: (selection) => {
			report.selection = selection
				? {
						path: selection.path,
						kind: selection.kind,
						...(selection.id === undefined ? {} : { id: selection.id }),
						...(selection.source === undefined ? {} : { source: selection.source }),
					}
				: null;
			out.textContent = JSON.stringify(report.selection, null, 1);
		},
		onOps: (patches) => {
			report.ops.push(...patches);
		},
	});

	// The button, and `E` as well for a person at the keyboard.
	const flip = (): void => {
		const next = document.documentElement.dataset.mode === "edit" ? "browse" : "edit";
		document.documentElement.dataset.mode = next;
		modeButton.textContent = next;
		status.textContent = `${path} — ${next}`;
		editor?.setMode();
	};
	modeButton.addEventListener("click", flip);
	window.addEventListener("keydown", (event) => {
		if (event.key === "e") flip();
	});
}

void main();
