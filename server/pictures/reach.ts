import { layout } from "../../protocol/index.ts";
import { deckPathFrom, inside, type Scope } from "../kernel/index.ts";

// What a scoped caller (a canvas pass) may have pictured (rule 18): only its own canvas, and only a
// card or page inside that canvas's folder. A path is made a deck path first (decoded once, a climb,
// a hidden part or a second encoding refused), and only then tested for where it lies.

/** Whether an address's path, as it came, names something inside the pass's canvas folder. */
export function reachesPath(scope: Scope, raw: string): boolean {
	if (scope.canvas === undefined) return false;
	try {
		return inside(deckPathFrom(raw), layout.canvasFolder(scope.canvas));
	} catch {
		return false;
	}
}

/** Whether a canvas named in an address is the pass's own. */
export function reachesCanvas(scope: Scope, raw: string | null): boolean {
	if (scope.canvas === undefined || raw === null) return false;
	try {
		return decodeURIComponent(raw) === scope.canvas;
	} catch {
		return false;
	}
}
