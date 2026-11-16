// The canvas page clients frame, and the pass its frame calls with.
import { defineFeature, type Feature, type Kernel } from "../kernel/index.ts";
import { passGuard } from "./guard.ts";
import { Passes, type PassTokens } from "./passes.ts";
import { passFilesRoute, passRoute } from "./routes.ts";
import { DIST, staticRoutes } from "./static.ts";

/**
 * page: false leaves the canvas page to the host (Studio serves its own); the passes stay. passMs is
 * how long a pass lives: an hour, or DECKS_PASS_MS, which a browser check shortens to see renewals.
 */
export type FrameOptions = { dist?: string; clock?: () => number; page?: boolean; passMs?: number };

export function frameFeature(options: FrameOptions = {}): Feature {
	let kernel: Kernel | undefined;
	const started = (): Kernel => {
		if (!kernel) throw new Error("frame has not started");
		return kernel;
	};
	const tokens: PassTokens = {
		issue: (who, label, scope) => started().callers.issue(who, label, scope),
		forget: (token) => started().callers.forget!(token),
	};
	const passes = new Passes(tokens, options.clock, options.passMs ?? (Number(process.env.DECKS_PASS_MS) || undefined));
	return defineFeature({
		name: "frame",
		calls: [],
		routes: [...(options.page === false ? [] : staticRoutes(options.dist ?? DIST)), passRoute(passes), passFilesRoute(passes, () => kernel?.url(), () => kernel)],
		start(k) {
			kernel = k;
			k.guard(passGuard(() => kernel));
		},
	});
}
