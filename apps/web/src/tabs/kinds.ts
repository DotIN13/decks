import type { TabKind } from "./kind.ts";
import { appKind } from "./kinds/app.tsx";
import { canvasKind } from "./kinds/canvas.tsx";
import { cardKind } from "./kinds/card.tsx";
import { documentKind } from "./kinds/document.tsx";

/** Every kind of tab, by name: a new kind is one more file in `kinds/` and one more line here. */
const KINDS: Record<string, TabKind> = { [canvasKind.name]: canvasKind, [cardKind.name]: cardKind, [documentKind.name]: documentKind, [appKind.name]: appKind };

export const kindOf = (name: string): TabKind | undefined => KINDS[name];

/** The kind that goes by a word in the window's address (`TabKind.address`). */
export const kindAt = (address: string): TabKind | undefined => Object.values(KINDS).find((kind) => kind.address === address);

/** Every kind, in the order the + lists what each offers. */
export const allKinds = (): TabKind[] => Object.values(KINDS);
