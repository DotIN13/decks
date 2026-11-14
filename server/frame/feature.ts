import { defineFeature, type Feature, type Kernel, type Tokens } from "../kernel/index.ts";
import { Passes } from "./passes.ts";
import { passFilesRoute, passRoute } from "./routes.ts";
import { DIST, staticRoutes } from "./static.ts";

// The canvas page clients frame, and the pass its frame calls with.

export type FrameOptions = { dist?: string; clock?: () => number };

export function frameFeature(options: FrameOptions = {}): Feature {
	let kernel: Kernel | undefined;
	const started = (): Kernel => {
		if (!kernel) throw new Error("frame has not started");
		return kernel;
	};
	const tokens: Tokens = {
		issue: (who, label) => started().callers.issue(who, label),
		revoke: (id) => started().callers.revoke(id),
		describe: (kind, now) => started().callers.describe(kind, now),
	};
	const passes = new Passes(tokens, options.clock);
	return defineFeature({
		name: "frame",
		calls: [],
		routes: [...staticRoutes(options.dist ?? DIST), passRoute(passes), passFilesRoute(passes, () => kernel?.url())],
		start(k) {
			kernel = k;
		},
	});
}
