/* @refresh reload */
// First: the frame probe (`?probe=<collector>`, passed on by the page), before anything adds a listener it may time.
import "../perf/probe.ts";
import { bootFrame } from "@decks/canvas/frame";
import "../index.css";

/*
 * The faces nearly every canvas sets its words in are served by the app itself (`public/fonts`, as
 * Fontsource names them), so they come from the harness, a network hop the frame makes anyway, and
 * a canvas has its words where the font CDN is far or not there. Every other face is the CDN's.
 */
const fonts = {
	base: new URL("/fonts/", location.href).href,
	files: [
		...["400-normal", "500-normal", "600-normal", "700-normal", "400-italic"].map((face) => `inter/latin-${face}.ttf`),
		...["400-normal", "500-normal", "600-normal", "700-normal"].map((face) => `jetbrains-mono/latin-${face}.ttf`),
	],
};

// The canvas, in the frame the app's page made for it (`@decks/canvas`, `frame/frame.tsx`), with the app's own tools beside it.
// The chrome is the canvas's alone, and loaded with it: a frame that shows a card, a document or an app asks for none of it.
bootFrame(document.getElementById("canvas")!, { fonts, chrome: () => import("../frame/chrome.tsx").then((chrome) => chrome.DecksFrameChrome) });
