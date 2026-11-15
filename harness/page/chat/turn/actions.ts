import { createSignal } from "solid-js";
import type { MessagePart } from "@decks/protocol";
import { pillElement, type PillHost } from "../../composer/pill/card.ts";
import type { MineReader } from "./view.tsx";

// A message you sent, drawn back with its pills: the host's reader, and the drawing.

const [mineReader, setReader] = createSignal<MineReader | undefined>();

/** How the host reads a message you sent back into its pills. */
export function setMineReader(reader: MineReader | undefined): void {
	setReader(() => reader);
}

/** Draw a sent message into its span: its words with its pills, not editable here. Answers the pills' host. */
export function drawMine(el: HTMLElement, text: string, parts: MessagePart[] | undefined): PillHost | undefined {
	const reading = mineReader()?.(text, parts);
	if (!reading) {
		el.textContent = text;
		return undefined;
	}
	el.replaceChildren(...reading.draft.map((node) => (node.type === "text" ? document.createTextNode(node.text) : pillElement(node))));
	// Not editable here: the attribute is the field's, for its caret.
	for (const pill of el.querySelectorAll<HTMLElement>("[contenteditable]")) pill.removeAttribute("contenteditable");
	return reading.pills;
}
