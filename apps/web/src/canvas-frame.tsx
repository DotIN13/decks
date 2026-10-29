/* @refresh reload */
import { bootFrame } from "@decks/canvas";
import "./index.css";

// The canvas, in the frame the app's page made for it (`@decks/canvas`, `frame/frame.tsx`).
bootFrame(document.getElementById("canvas")!);
