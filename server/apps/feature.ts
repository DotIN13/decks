import { join } from "node:path";
import { events } from "../../protocol/index.ts";
import { defineFeature, type Context, type Feature, type Kernel, type Route } from "../kernel/index.ts";
import { appCalls } from "./calls.ts";
import { appKind } from "./item.ts";
import { portCalls } from "./port-calls.ts";
import { serveForward, upgradeForward } from "./ports.ts";
import { passInPath, serveApp, upgradeApp } from "./serve.ts";
import { Apps } from "./service.ts";
import { upgradeApps } from "./upgrade.ts";
import { openRoute } from "./open.ts";

// The apps feature: app folders served, built or run, and forwarded ports.

export type AppsFeatureOptions = { workdir?: string; clock?: () => number };

/** Apps and ports. workdir is where in-deck apps' copies run: by default <machine>/app-run/<deck id>. */
export function appsFeature(options: AppsFeatureOptions = {}): Feature {
	let kernel: Kernel | undefined;
	let apps: Apps | undefined;
	const clock = options.clock ?? Date.now;
	const need = () => {
		if (!apps || !kernel) throw new Error("The apps feature has not started.");
		return apps;
	};
	return defineFeature({
		name: "apps",
		calls: [...appCalls(need, () => kernel!), ...portCalls(clock)],
		items: [appKind],
		routes: appRoutes(need, () => kernel!),
		async upgrade(deck, _version, parts) {
			await upgradeApps(deck, parts.old, parts.stores("apps"), (line) => console.log(`[upgrade] ${line}`));
		},
		start(given) {
			kernel = given;
			const workdir = options.workdir ?? join(given.machine(), "app-run", given.deckId());
			const env = (name: string): Record<string, string> => {
				const url = given.url();
				const token = given.callers.issue({ kind: "app", id: name, name }, "app server");
				return { ...(url ? { DECKS_URL: url } : {}), DECKS_TOKEN: token };
			};
			apps = new Apps(given.deck, given.store("apps"), { workdir, env, clock });
			let rev = 0;
			apps.onChange = (name, status) => given.events.emit(events.appChanged, { ids: [name], by: name, rev: ++rev, ...(status ? { status } : {}) });
			const sweep = setInterval(() => void apps?.sleepUnseen(), 60_000);
			sweep.unref();
			return () => {
				clearInterval(sweep);
				apps?.stopAll();
			};
		},
	});
}

function appRoutes(apps: () => Apps, kernel: () => Kernel): Route[] {
	const app: Route = {
		method: "ANY",
		prefix: "/app/",
		tokenOf: passInPath,
		serve: (ctx, req, res) => serveApp(ctx, apps(), req, res),
		upgrade: (req, socket, head, door) => upgradeApp(apps(), req, socket, head, door),
	};
	const forward = (prefix: string): Route => ({
		method: "ANY",
		prefix,
		serve: (ctx: Context, req, res) => serveForward(ctx, req, res),
		upgrade: (req, socket, head, door) => upgradeForward(req, socket, head, door),
	});
	return [app, forward("/node/"), forward("/rnode/"), openRoute(kernel)];
}
