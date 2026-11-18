/* @refresh reload */
// First: the frame probe (`?probe=<collector>`, passed on by the page), before anything adds a listener it may time.
import "../perf/probe.ts";
import { bootFrame, useShippedFonts } from "@decks/canvas";
import "../index.css";
import { DecksFrameChrome } from "../frame/chrome.tsx";

/*
 * The faces nearly every canvas sets its words in are served by the app itself (`public/fonts`, as
 * Fontsource names them), so they come from the harness, a network hop the frame makes anyway, and
 * a canvas has its words where the font CDN is far or not there. Every other face is the CDN's.
 */
useShippedFonts(new URL("/fonts/", location.href).href, [
	...["400-normal", "500-normal", "600-normal", "700-normal", "400-italic"].map((face) => `inter/latin-${face}.ttf`),
	...["400-normal", "500-normal", "600-normal", "700-normal"].map((face) => `jetbrains-mono/latin-${face}.ttf`),
]);

// The canvas, in the frame the app's page made for it (`@decks/canvas`, `frame/frame.tsx`), with the app's own tools beside it.
bootFrame(document.getElementById("canvas")!, { chrome: DecksFrameChrome });
