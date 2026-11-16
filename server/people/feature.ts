import { defineFeature, type Feature } from "../kernel/types.ts";
import { agentCalls } from "./agent-calls.ts";
import { Holder, People } from "./state.ts";
import { viewCalls } from "./view-calls.ts";

// Who is here: agents' records, mail, hosts, news and views. Starts no one.

export function peopleFeature(): Feature {
	const holder = new Holder();
	return defineFeature({
		name: "people",
		calls: [...agentCalls(holder), ...viewCalls(holder)],
		async start(kernel) {
			holder.set(await People.start(kernel));
		},
	});
}
