import { calls, type Handled } from "../../protocol/index.ts";
import { handleAll, type Context } from "../kernel/index.ts";
import { close, forwards, open } from "./ports.ts";

// The port calls. Rule 12 of the README.

export function portCalls(clock: () => number): Handled<Context>[] {
	const { port } = calls;
	return handleAll({ list: port.list, open: port.open, close: port.close }, {
		list: (ctx) => forwards(ctx.store),
		open: (ctx, { port: number, label }) => open(ctx.store, number, label, ctx.caller.name, clock()),
		close: async (ctx, { port: number }) => {
			await close(ctx.store, number);
			return { deleted: String(number) };
		},
	});
}
