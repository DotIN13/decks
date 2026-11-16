import { layout, Refused } from "../../protocol/index.ts";
import { deckPathFrom, inside, toDeckPath, type Context, type DeckPath, type Scope } from "../kernel/index.ts";

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

/** Where a file a call writes may go. A whole caller: to, else the default. A pass: its own canvas's
 *  exports/ or files/ only, its default under files/exports/, and never over a file already there. */
export async function writeTarget(ctx: Context, to: string | undefined, fallback: string): Promise<DeckPath> {
	const scope = ctx.scope;
	if (!scope) return toDeckPath(to ?? fallback);
	if (scope.canvas === undefined) throw new Refused("refused", "This pass names no canvas to write into.", "canvas.screenshot");
	const folder = layout.canvasFolder(scope.canvas);
	const path = to === undefined ? toDeckPath(`${folder}/files/exports/${fallback.split("/").pop()}`) : deckPathFrom(to);
	if (!inside(path, `${folder}/exports`) && !inside(path, `${folder}/files`)) throw new Refused("refused", `A pass writes only into ${folder}/exports/ or ${folder}/files/, not ${path}.`, "canvas.screenshot");
	if (await ctx.deck.read(path).then(() => true, () => false)) throw new Refused("conflict", `${path} is there already; a pass never writes over a file. Name another to.`, "canvas.screenshot");
	return path;
}

/** Refuse a card path a pass names in of when it is outside the pass's canvas folder. */
export function reachOf(scope: Scope | undefined, of: unknown): void {
	if (!scope) return;
	const named = (typeof of === "string" ? [of] : Array.isArray(of) ? of : []).filter((one): one is string => typeof one === "string" && one.includes("/"));
	for (const path of named) if (!reachesPath(scope, path)) throw new Refused("refused", `This pass pictures only its own canvas, not ${path}.`, "canvas.screenshot");
}
