// What a canvas places, by path: a pass reaches its canvas's folder, the shared roots, and whatever its
// canvas's drawing already names, as today's passCovers did: an old page kept at the deck's root, a
// document opened from elsewhere in the deck. Each name the drawing holds (a url, path, card or file field,
// a metadata path) is read in every spelling the canvas resolves it to, and compared as a deck path.
import { layout, type Caller } from "../../protocol/index.ts";
import { toDeckPath, type Kernel } from "../kernel/index.ts";

const FIELDS = new Set(["url", "path", "card", "file"]);

/** Whether the canvas's drawing names this deck path, in any of its spellings. */
export async function placedOn(kernel: Kernel | undefined, canvas: string, caller: Caller | undefined, path: string): Promise<boolean> {
	if (!kernel || !path) return false;
	const asker: Caller = { ...(caller ?? { kind: "person", name: "frame" }), id: "frame-guard", kind: "person", canvas };
	const got = await kernel.call("canvas.drawing", { canvas }, asker).catch(() => undefined);
	if (!got?.ok) return false;
	return namesIn(got.value, canvas).has(path);
}

/** Every deck path a drawing names, each in its spellings: as written, and as the canvas resolves it. */
function namesIn(drawing: unknown, canvas: string): Set<string> {
	const out = new Set<string>();
	const add = (raw: string) => {
		for (const one of [raw, raw.replace(/^\/+/, "")]) {
			try {
				out.add(toDeckPath(decodeOnce(one)));
			} catch {
				/* not a deck path */
			}
		}
		const resolved = layout.resolveReference(canvas, raw);
		if ("path" in resolved) out.add(resolved.path);
	};
	const walk = (value: unknown, depth: number) => {
		if (depth > 60 || value === null || typeof value !== "object") return;
		if (Array.isArray(value)) return void value.forEach((one) => walk(one, depth + 1));
		for (const [key, one] of Object.entries(value)) {
			if (FIELDS.has(key) && typeof one === "string" && !/^(?:https?:|data:|blob:)/i.test(one)) add(one);
			else walk(one, depth + 1);
		}
	};
	walk(drawing, 0);
	return out;
}

function decodeOnce(raw: string): string {
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}
