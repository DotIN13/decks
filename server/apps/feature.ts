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

/** An app server's token ends when its app stops, sleeps or breaks; 30 days is only a backstop, as a run may last days. */
const SERVER_TOKEN_MS = 30 * 24 * 3600_000;

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
				// One live token per app server: the last run's goes before a new run's is given.
				given.callers.revoke(name);
				const token = given.callers.issue({ kind: "app", id: name, name }, "app server", { until: Date.now() + SERVER_TOKEN_MS });
				return { ...(url ? { DECKS_URL: url } : {}), DECKS_TOKEN: token };
			};
			apps = new Apps(given.deck, given.store("apps"), { workdir, env, clock });
			// A canvas pass hears app.changed for an app placed on its canvas: the app's window there listens.
			given.belongs((scope, event, payload) => event === "app.changed" && scope.canvas !== undefined && placedOn(given, scope.canvas, (payload.ids as string[] | undefined)?.[0]));
			let rev = 0;
			apps.onChange = (name, status) => {
				// A server app that is not running holds no token.
				if (status !== "running" && status !== "starting") given.callers.revoke(name);
				given.events.emit(events.appChanged, { ids: [name], by: name, rev: ++rev, ...(status ? { status } : {}) });
			};
			const sweep = setInterval(() => void apps?.sleepUnseen(), 60_000);
			sweep.unref();
			return () => {
				clearInterval(sweep);
				apps?.stopAll();
			};
		},
	});
}

/** Whether an app is placed on a canvas, read from the drawing as it is now. */
function placedOn(kernel: Kernel, canvas: string, app: string | undefined): boolean {
	if (!app) return false;
	try {
		return kernel.canvas(canvas).read().some((item) => item.type === "app" && item.app === app);
	} catch {
		return false;
	}
}

function appRoutes(apps: () => Apps, kernel: () => Kernel): Route[] {
	const app: Route = {
		method: "ANY",
		prefix: "/app/",
		tokenOf: passInPath,
		// A pass reaches an app's pages; serveApp holds it to the app it was issued for.
		scoped: () => true,
		serve: (ctx, req, res) => serveApp(ctx, apps(), req, res),
		upgrade: (req, socket, head, door) => upgradeApp(apps(), req, socket, head, door),
	};
	const forward = (prefix: string): Route => ({
		method: "ANY",
		prefix,
		// Forwarded ports are the person's own local servers, which cards on a canvas frame.
		scoped: () => true,
		serve: (ctx: Context, req, res) => serveForward(ctx, req, res),
		upgrade: (req, socket, head, door) => upgradeForward(req, socket, head, door),
	});
	return [app, forward("/node/"), forward("/rnode/"), openRoute(kernel)];
}
