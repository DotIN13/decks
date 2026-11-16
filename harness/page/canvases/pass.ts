import { api } from "../connections/connection.ts";
import { authHeaders } from "../lib/session.ts";
import type { CanvasPass } from "@decks/canvas";

// A pass for the canvas frame to reach its one canvas, asked for with this tab's token and
// kept for half its life, so a card's addresses stay the same between visits.

/**
 * A canvas pass for the one canvas the frame shows (`server/frame/passes.ts`), asked for with this
 * tab's token: the frame makes its calls with it in the header, and reads that canvas's files and
 * pictures with it in their address, since it has no token and no cookie of its own. It lives an
 * hour; the frame's host asks for the next one at half that (`@decks/canvas`, `host/outside/framed-editor.tsx`).
 */
export function canvasPass(canvas: string): Promise<CanvasPass> {
	/*
	 * One pass per canvas for the first half of its life, given again to whoever asks: a card's
	 * pictures, modules and sheets carry the pass in their address, so a new pass at every visit made
	 * every address new and the browser fetched every card again. The host asks again at half its
	 * life (`renew`), which is when this lets it go, so a renewal gets a new one.
	 */
	const kept = passes.get(canvas);
	if (kept && Date.now() < kept.until) return kept.pass;
	const pass = askPass(canvas);
	const entry = { pass, until: Date.now() + 25 * 60_000 };
	passes.set(canvas, entry);
	void pass.then(
		(got) => (entry.until = Date.now() + (got.expires - Date.now()) / 2 - 60_000),
		() => passes.get(canvas) === entry && passes.delete(canvas),
	);
	return pass;
}

/** The pass each canvas was last given, and until when it is given again. */
const passes = new Map<string, { pass: Promise<CanvasPass>; until: number }>();

async function askPass(canvas: string): Promise<CanvasPass> {
	const response = await fetch(api("/passes"), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ canvas }) });
	const answer = (await response.json().catch(() => ({}))) as { pass?: string; expires?: number; error?: string; imports?: Record<string, string> };
	if (!answer.pass) throw new Error(`No pass for the canvas ${canvas}: ${answer.error ?? response.status}`);
	const at = (rest: string) => new URL(api(`/t/${answer.pass}/${rest}`), location.href).href;
	return {
		api: new URL("/compat", location.href).href,
		token: answer.pass,
		files: at("card/"),
		pictures: at("thumb/"),
		expires: answer.expires ?? Date.now() + 3_600_000,
		// The deck's import map, handed to the frame once: none (an older harness) and each card looks for it itself.
		...(answer.imports ? { imports: answer.imports } : {}),
	};
}
