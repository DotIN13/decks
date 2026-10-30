/* @refresh reload */
// First: the frame probe (`?probe=<collector>`, passed on by the page), before anything adds a listener it may time.
import "./perf/probe.ts";
import { bootFrame } from "@decks/canvas";
import "./index.css";
import { DecksFrameChrome } from "./frame/chrome.tsx";

// The canvas, in the frame the app's page made for it (`@decks/canvas`, `frame/frame.tsx`), with the app's own tools beside it.
bootFrame(document.getElementById("canvas")!, { chrome: DecksFrameChrome });
