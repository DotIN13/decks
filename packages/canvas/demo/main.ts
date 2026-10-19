import { mountCanvas, type PenEdit } from "@decks/canvas";
import "@decks/canvas/styles.css";
import sample from "./sample.pen?raw";

/*
 * A canvas from a `.pen` file, with no Decks server: boards are pages in `public/boards/`, and every
 * edit the person makes is printed here and kept on `window.__edits`, which is what a host would save.
 */
const edits: PenEdit[][] = [];
const out = document.querySelector<HTMLOutputElement>("#edits")!;
const host = document.querySelector<HTMLElement>("#canvas")!;
const base = new URL("./", location.href).href;

const canvas = mountCanvas(host, {
	text: sample,
	base,
	boards: {
		page: (path) => new URL(path, base).href,
		picture: () => undefined,
	},
	onEdits(batch) {
		edits.push(batch);
		out.value = `${edits.length} edit${edits.length === 1 ? "" : "s"}: ${batch.map((one) => `${one.op} ${"id" in one ? one.id : one.key}${one.op === "set" ? `.${one.key}` : ""}`).join(", ")}`;
		console.log("[demo] edits", JSON.stringify(batch));
	},
});

let mode: "edit" | "browse" = "edit";
let dark = false;
let ink = false;
const modeButton = document.querySelector<HTMLButtonElement>("#mode")!;
modeButton.onclick = () => {
	mode = mode === "edit" ? "browse" : "edit";
	ink = false;
	canvas.setMode(mode);
	modeButton.textContent = mode === "edit" ? "Browse" : "Edit";
};
document.querySelector<HTMLButtonElement>("#ink")!.onclick = () => {
	ink = !ink;
	canvas.setDrawing(ink);
	if (ink) {
		mode = "browse";
		modeButton.textContent = "Edit";
	}
};
document.querySelector<HTMLButtonElement>("#dark")!.onclick = () => {
	dark = !dark;
	canvas.setDark(dark);
};

Object.assign(window, { __canvas: canvas, __edits: edits });
