import type { TabKind } from "./kind.ts";
import { canvasKind } from "./kinds/canvas.tsx";
import { cardKind } from "./kinds/card.tsx";
import { documentKind } from "./kinds/document.tsx";

/** Every kind of tab, by name: a new kind is one more file in `kinds/` and one more line here. */
const KINDS: Record<string, TabKind> = { [canvasKind.name]: canvasKind, [cardKind.name]: cardKind, [documentKind.name]: documentKind };

export const kindOf = (name: string): TabKind | undefined => KINDS[name];
