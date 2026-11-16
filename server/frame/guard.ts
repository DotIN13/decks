// A canvas pass is held to its canvas (README rule 5), on every door, since every door calls through the
// kernel's guards. A pass's caller (<asker>~frame-<n>, canvas set) makes only the frame's own calls and the
// card set (protocol's callsFor("card")), names no other canvas, and reaches files and cards only in its
// own canvas's folder, the deck's shared roots, or a document its drawing places. Compat's line did this
// for the old wire (boundTo); the protocol's socket, HTTP and MCP doors did not until this guard.
import { layout, Refused, type Caller } from "../../protocol/index.ts";
import type { Kernel } from "../kernel/index.ts";
import { isPass, PASS_CALLS } from "./passes.ts";

/** The deck's roots every canvas reads from (the pass's file route serves the same). */
const SHARED_ROOTS = ["assets/", "lib/", "docs/", "apps/"];

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
		for (const path of cardPaths(name, args)) if (!inCanvas(canvas, path)) throw refuse(name, `${path} is not a card of ${canvas}`);
		if (name.startsWith("file.") || name === "frame.get") {
			const path = String(args.path ?? "");
			if (!inCanvas(canvas, path) && !SHARED_ROOTS.some((root) => path.startsWith(root)) && !(await placed(kernel(), canvas, caller, path))) {
				throw refuse(name, `${path} is not in ${canvas}'s folder, the deck's shared roots, or a document on ${canvas}`);
			}
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

/** Whether a deck path is inside a canvas's own folder. */
function inCanvas(canvas: string, path: string): boolean {
	try {
		return path.replace(/^\/+/, "").startsWith(`${layout.canvasFolder(canvas)}/`);
	} catch {
		return false;
	}
}

/** Whether the canvas's drawing places a document at this path (a document item opened from the deck). */
async function placed(kernel: Kernel | undefined, canvas: string, caller: Caller, path: string): Promise<boolean> {
	if (!kernel || !path) return false;
	const got = await kernel.call("canvas.drawing", { canvas }, { ...caller, id: "frame-guard", kind: "person" }).catch(() => undefined);
	if (!got?.ok) return false;
	return JSON.stringify(got.value).includes(`"path":${JSON.stringify(path)}`);
}

const refuse = (name: string, why: string) => new Refused("refused", `A canvas pass may not call ${name}: ${why}.`, "canvas.here");
