import { calls, events, Refused } from "../../protocol/index.ts";
import { defineFeature, handle } from "./types.ts";

// A small feature for the kernel's own tests: port.open and port.list kept in
// a list, so a call can be made, refused and heard through every door.

type Port = { port: number; label?: string; at: number; path: string; stripped: string };

export function probeFeature() {
	const ports: Port[] = [];
	return defineFeature({
		name: "probe",
		calls: [
			handle(calls.port.list, () => ports),
			handle(calls.port.open, (ctx, { port, label }) => {
				if (ports.some((one) => one.port === port)) throw new Refused("conflict", `Port ${port} is already open.`, "port.list");
				const opened: Port = { port, at: 1, path: `/port/${port}/`, stripped: `/rport/${port}/`, ...(label ? { label } : {}) };
				ports.push(opened);
				ctx.note(`opened ${port}`);
				ctx.events.emit(events.deckChanged, { ids: [String(port)], by: ctx.caller.id, rev: ports.length, part: "ports" });
				return opened;
			}),
		],
	});
}
