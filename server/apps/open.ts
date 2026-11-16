import { layout } from "../../protocol/index.ts";
import type { Context, Kernel, Route, RouteAnswer } from "../kernel/index.ts";
import { APP_NAME, manifestOf } from "./manifest.ts";

// POST /app-pass/<name> (rule 13): a canvas's frame, on its canvas pass, opens an app placed on
// that canvas inside it. The answer is the app's address with an app pass in its path.

export const OPEN = "/app-pass/";
const json = (status: number, value: unknown): RouteAnswer => ({ status, type: "application/json", body: JSON.stringify(value), headers: { "cache-control": "no-store" } });

export function openRoute(kernel: () => Kernel): Route {
	const given: Given = new Map();
	return { method: "POST", prefix: OPEN, scoped: (_scope, asked) => asked.method === "POST", answer: (ctx, path) => answer(ctx, kernel(), given, path) };
}

async function answer(ctx: Context, kernel: Kernel, given: Given, path: string): Promise<RouteAnswer> {
	const name = decodeURIComponent(path.slice(OPEN.length)).replace(/\/+$/, "");
	if (!APP_NAME.test(name)) return json(404, { error: `There is no app called ${name}.` });
	const canvas = ctx.caller.canvas;
	if (!canvas) return json(403, { error: "An app is opened in a canvas by that canvas's frame, with its canvas pass." });
	if (layout.isSharedCanvas(canvas)) return json(403, { error: "Apps open inside a canvas only on a canvas that is yours alone; on this one, open it in a tab.", tab: true });
	const manifest = await manifestOf(ctx.deck, name).catch(() => undefined);
	if (!manifest) return json(404, { error: `There is no app called ${name}.` });
	if (!(await placed(ctx, canvas, name))) return json(403, { error: `${name} is not placed on this canvas.` });
	if (manifest.prefix) return json(409, { error: `${name} is told its base path, so it loads by absolute addresses; open it in a tab.`, tab: true });
	return json(200, { url: `/app/t/${issuePass(kernel, given, name, canvas)}/${name}/` });
}

const PASS_MS = 12 * 3600_000;
const KEPT = 3;
/** The passes given for each app on each canvas since the server started, newest last. */
type Given = Map<string, string[]>;

/** A pass for the app's page on one canvas: no calls, twelve hours, and only the newest three live. */
function issuePass(kernel: Kernel, given: Given, name: string, canvas: string): string {
	const id = `${name}~${canvas}`;
	const live = given.get(id) ?? (kernel.callers.revoke(id), []);
	const pass = kernel.callers.issue({ kind: "app", id, name, canvas }, `app ${name} on ${canvas}`, { canvas, calls: [], until: Date.now() + PASS_MS });
	live.push(pass);
	while (live.length > KEPT) kernel.callers.forget?.(live.shift()!);
	given.set(id, live);
	return pass;
}

async function placed(ctx: Context, canvas: string, name: string): Promise<boolean> {
	const items = await ctx.call<{ type: string; app?: string }[]>("item.list", { canvas, depth: 0 }).catch(() => []);
	return items.some((item) => item.type === "app" && item.app === name) && placedByWhole(ctx, canvas, name);
}

/** A pass's caller id: a frame's (asker~frame-n), an app's (name~canvas), a picture's, or a card's (its path). */
const passId = (by: string) => by.includes("~") || by.includes("/") || by.startsWith("picture-");

/** Whether the last change this server saw place the app on the canvas was a whole caller's (the person or an
 *  agent), never a pass's. A placement from before the server's history counts as whole. */
function placedByWhole(ctx: Context, canvas: string, name: string): boolean {
	let by: string | undefined;
	try {
		for (const change of ctx.canvas(canvas).since(0)) {
			for (const op of change.ops) if ((op.op === "insert" || op.op === "replace") && op.item.type === "app" && op.item.app === name) by = change.by;
		}
	} catch {
		return true;
	}
	return by === undefined || !passId(by);
}
