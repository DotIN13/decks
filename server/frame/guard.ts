// A canvas pass is held to its canvas (README rule 5), on every door, since every door calls through the
// kernel's guards. A pass's caller (<asker>~frame-<n>, canvas set) makes only the frame's own calls and the
// card set (protocol's callsFor("card")), names no other canvas, and reaches files and cards only in its
// own canvas's folder, the deck's shared roots, or what its canvas places (kernel.placed, one answer).
// What a pass's edit may name inside an item is the canvas feature's rule (server/canvas, on ctx.scope).
import { Refused, type Caller } from "../../protocol/index.ts";
import type { Kernel } from "../kernel/index.ts";
import { isPass, PASS_CALLS } from "./passes.ts";
import { inCanvas, inSharedRoot, plainPath } from "./paths.ts";

type Args = Record<string, unknown>;

/** The guard: throws a plain refusal for a pass's call outside its canvas or outside the calls a frame makes. */
export function passGuard(kernel: () => Kernel | undefined) {
	const allowed = new Set(PASS_CALLS);
	return async (name: string, raw: unknown, caller: Caller): Promise<void> => {
		if (!isPass(caller.id)) return;
		const canvas = caller.canvas;
		if (!canvas) throw refuse(name, "it names no canvas");
		if (!allowed.has(name)) throw refuse(name, `a canvas pass makes only the frame's calls and its cards' calls, not ${name}`);
		const args = (typeof raw === "object" && raw !== null ? raw : {}) as Args;
		if (args.canvas === undefined) args.canvas = canvas;
		else if (args.canvas !== canvas) throw refuse(name, `it is ${canvas}'s pass, and names ${String(args.canvas)}`);
		const clip = args.clip as { canvas?: unknown } | undefined;
		if (clip && typeof clip === "object" && clip.canvas !== undefined && clip.canvas !== canvas) throw refuse(name, `it pastes from ${String(clip.canvas)}, another canvas`);
		const reaches = (path: string) => inCanvas(canvas, path) || kernel()?.placed(canvas, path) === true;
		for (const path of cardPaths(name, args)) if (!reaches(path)) throw refuse(name, `${path} is not a card of ${canvas}, nor one it places`);
		// A document's words reach the frame through its document line, so file.read is only a kept version's.
		if (name === "file.read" && typeof args.sha !== "string") throw refuse(name, "a pass reads a document's kept versions only (with sha)");
		if (name.startsWith("file.") || name === "frame.get" || (name.startsWith("google.") && args.path !== undefined)) {
			const path = plainPath(args.path);
			if (!path) throw refuse(name, `${String(args.path)} is not a plain path`);
			// A document is opened, typed in and reviewed only where its canvas is or places it (Reader, step 6): never
			// a document of the shared roots no canvas places. Only file.url, an address to read, reaches those roots.
			const readOnly = name === "file.url";
			if (!reaches(path) && !(readOnly && inSharedRoot(path))) throw refuse(name, `${path} is not in ${canvas}'s folder or placed on ${canvas}`);
		}
	};
}

/** The card paths a call names: a card argument, a card list, a focus target written as a path. */
function cardPaths(name: string, args: Args): string[] {
	const out: string[] = [];
	if (typeof args.card === "string") out.push(args.card);
	if (Array.isArray(args.cards)) out.push(...args.cards.filter((c): c is string => typeof c === "string"));
	if (name === "view.focus") out.push(...[args.target].flat().filter((t): t is string => typeof t === "string" && t.includes("/")));
	return out;
}

const refuse = (name: string, why: string) => new Refused("refused", `A canvas pass may not call ${name}: ${why}.`, "canvas.here");
