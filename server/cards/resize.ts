import { events, Refused, type Caller } from "../../protocol/index.ts";
import type { Kernel, Stop } from "../kernel/types.ts";
import { fence } from "./fence.ts";
import { metaSize, withSize } from "./prepare.ts";

// Rule 18: a card resized on its canvas writes the new size into its own file.

const decoder = new TextDecoder();
const encoder = new TextEncoder();
type Edit = { op?: string; id?: string; size?: { w?: number; h?: number }; set?: Record<string, unknown> };

const resizes = (edit: Edit) => edit.op === "update" && !!edit.id && (!!edit.size || (edit.set && ("width" in edit.set || "height" in edit.set)));
const callerOf = (by: string): Caller => ({ kind: by === "person" ? "person" : "agent", id: by, name: by });

/** Listen for resized cards; their files follow. */
export function followSizes(kernel: Kernel): Stop {
	return kernel.events.on(events.itemChanged, (change) => {
		const ids = ((change.edits ?? []) as Edit[]).filter(resizes).map((edit) => edit.id!);
		if (ids.length && change.canvas) void write(kernel, change.canvas, ids, change.by).catch(() => undefined);
	});
}

async function write(kernel: Kernel, canvas: string, ids: string[], by: string): Promise<void> {
	for (const item of kernel.canvas(canvas).read({ ids })) {
		if (item.type !== "card" || typeof item.card !== "string" || !item.box) continue;
		const size = { w: Math.round(item.box.x2 - item.box.x1), h: Math.round(item.box.y2 - item.box.y1) };
		let path;
		try {
			path = fence(item.card);
		} catch (error) {
			if (error instanceof Refused) continue;
			throw error;
		}
		const source = decoder.decode(await kernel.deck.read(path));
		const meta = metaSize(source);
		if (meta.w === size.w && meta.h === size.h) continue;
		await kernel.deck.write(path, encoder.encode(withSize(source, size)), callerOf(by));
	}
}
