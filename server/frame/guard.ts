// A canvas pass is held to its canvas (README rule 5), on every door, since every door calls through the
// kernel's guards. A pass's caller (<asker>~frame-<n>, canvas set) makes only the frame's own calls and the
// card set (protocol's callsFor("card")), names no other canvas, and reaches files and cards only in its
// own canvas's folder, the deck's shared roots, or a document its drawing places. Compat's line did this
// for the old wire (boundTo); the protocol's socket, HTTP and MCP doors did not until this guard.
import { Refused, type Caller } from "../../protocol/index.ts";
import type { Kernel } from "../kernel/index.ts";
import { isPass, PASS_CALLS } from "./passes.ts";
import { inCanvas, inSharedRoot, itemPathOk, plainPath } from "./paths.ts";

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
		// Every path written into an item a pass inserts or changes: its own canvas or a shared root (Reader, 6).
		if (name.startsWith("item.")) for (const path of itemPaths(args)) if (!itemPathOk(canvas, path)) throw refuse(name, `an item may not name ${String(path)}, outside ${canvas}'s folder and the deck's shared roots`);
		// A document's words reach the frame through its document line, so file.read is only a kept version's.
		if (name === "file.read" && typeof args.sha !== "string") throw refuse(name, "a pass reads a document's kept versions only (with sha)");
		if (name.startsWith("file.") || name === "frame.get" || (name.startsWith("google.") && args.path !== undefined)) {
			const path = plainPath(args.path);
			if (!path) throw refuse(name, `${String(args.path)} is not a plain path`);
			if (!inCanvas(canvas, path) && !inSharedRoot(path) && !(await placed(kernel(), canvas, caller, path))) {
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

/** Every path or card an item names, at any depth (a card item, a document, a browser item's metadata), in a call's items, ops and sets. */
function itemPaths(args: Args): unknown[] {
	const out: unknown[] = [];
	const walk = (value: unknown, depth: number) => {
		if (depth > 40 || value === null || typeof value !== "object") return;
		if (Array.isArray(value)) return void value.forEach((one) => walk(one, depth + 1));
		for (const [key, one] of Object.entries(value)) {
			if ((key === "path" || key === "card") && typeof one === "string") out.push(one);
			else walk(one, depth + 1);
		}
	};
	for (const key of ["item", "ops", "set"]) walk(args[key], 0);
	return out;
}

/** Whether the canvas's drawing places a document at this path (a document item opened from the deck). */
async function placed(kernel: Kernel | undefined, canvas: string, caller: Caller, path: string): Promise<boolean> {
	if (!kernel || !path) return false;
	const got = await kernel.call("canvas.drawing", { canvas }, { ...caller, id: "frame-guard", kind: "person" }).catch(() => undefined);
	if (!got?.ok) return false;
	return JSON.stringify(got.value).includes(`"path":${JSON.stringify(path)}`);
}

const refuse = (name: string, why: string) => new Refused("refused", `A canvas pass may not call ${name}: ${why}.`, "canvas.here");
