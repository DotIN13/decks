import { toWorld } from "@decks/canvas/camera";
import { camera } from "../state/camera.ts";
import { act } from "../state/decks.ts";
import type { Tab } from "./kind.ts";
import { addressOf } from "./remember.ts";
import { canvasOnScreen } from "./tabs.ts";

/**
 * Put a link to something in the deck on the canvas on screen, as a chip (`@decks/pen`, `link.ts`):
 * in the middle of the view, or at a point of the window it was dropped at. The harness makes the
 * chip, since it knows what the address names and what it is called (`canvas.insert`, `{ type: "link" }`),
 * and says why when it will not (a canvas shared to view, a target that is gone).
 */
export async function placeLink(to: Pick<Tab, "kind" | "target">, client?: { x: number; y: number }): Promise<void> {
	const canvas = canvasOnScreen()?.name;
	const element = document.querySelector<HTMLElement>(".stage, iframe.canvas-frame");
	const address = addressOf(to);
	if (!canvas || !element || !address) return;
	const box = element.getBoundingClientRect();
	const view = client ? { x: client.x - box.left, y: client.y - box.top } : { x: element.clientWidth / 2, y: element.clientHeight / 2 };
	const at = toWorld(camera(), { width: element.clientWidth, height: element.clientHeight }, view);
	// About half a chip up and to the left, so its middle is where it was put.
	await act("canvas.insert", [{ type: "link", to: address }, { canvas, at: { x1: Math.round(at.x - 80), y1: Math.round(at.y - 18) } }]);
}
