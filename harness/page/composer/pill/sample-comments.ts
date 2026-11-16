import type { WaitingComment } from "../../state/index.ts";
import type { DraftMention } from "../draft/model.ts";

// The comments and pills the pill tests share: one written on a card, one the canvas handed over,
// one on drawn items, and a card and an item pill, with the names a page would look up.

export const mine: WaitingComment = { id: "c1", path: "canvases/md/cards/sdk/index.html", component: "choices", quote: "Corner only", text: "Use this one.", at: 1 };
export const handed: WaitingComment = { id: "c2", path: "canvases/md/cards/sdk/index.html", quote: "SDK; each", text: "test note\nsecond line", at: 2, from: "canvas" };
export const drawn: WaitingComment = { id: "c3", path: "canvases/md/canvas.pen", items: ["note-4", "arrow-7"], quote: "hello", text: "", at: 3 };
export const card: DraftMention = { type: "mention", kind: "card", id: "canvases/x/cards/the-chrome-choice/index.html", label: "The chrome choice" };
export const item: DraftMention = { type: "mention", kind: "item", id: "rect-9", label: "a square", name: "a square" };
export const longTitle = "The chrome choice is who owns the canvas's behaviour rules and the frame's";
export const titleOf = (path: string) => (path === card.id ? longTitle : path.endsWith("sdk/index.html") ? "SDK redesign decisions" : undefined);
export const itemName = (id: string) => (id === "note-4" ? "Seventeen gaps remain" : undefined);
