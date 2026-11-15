import { calls, type Handled } from "../../protocol/index.ts";
import { handleAll, type Context } from "../kernel/index.ts";
import { exportItems } from "./export.ts";
import type { Extents } from "./extent.ts";
import { fit } from "./fit.ts";
import type { Machine } from "./machine.ts";
import { screenshot } from "./shot.ts";

// One short handler per call: card.fit, canvas.screenshot, canvas.export.

const PICTURE = { fit: calls.card.fit, screenshot: calls.canvas.screenshot, exportPage: calls.canvas.exportPage };

export function pictureCalls(m: () => Machine, extents?: Extents): Handled<Context>[] {
	return handleAll(PICTURE, {
		fit: (ctx, args) => fit(ctx, m(), args, extents),
		screenshot: (ctx, args) => screenshot(ctx, m(), args),
		exportPage: (ctx, args) => exportItems(ctx, args),
	});
}
