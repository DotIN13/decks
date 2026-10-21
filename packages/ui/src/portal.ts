/**
 * Where the canvas's popovers, menus and pickers go: one `.decks-layer` at the end of the page, so a
 * panel's scrolling never clips them, and the canvas's scoped stylesheet (`dist/canvas.css`, which
 * styles `.decks-canvas` and `.decks-layer` only) still reaches them.
 */
let layer: HTMLElement | undefined;

export function portalLayer(): HTMLElement {
	if (!layer || !layer.isConnected) {
		layer = document.createElement("div");
		layer.className = "decks-layer";
		document.body.append(layer);
	}
	return layer;
}
