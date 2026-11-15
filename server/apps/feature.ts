import { join } from "node:path";
import { defineFeature, type Context, type Feature, type Kernel, type Route } from "../kernel/index.ts";
import { appCalls } from "./calls.ts";
import { appKind } from "./item.ts";
import { portCalls } from "./port-calls.ts";
import { forwardTarget, serveForward } from "./ports.ts";
import { upgradeTo } from "./proxy.ts";
import { parseAppPath, passInPath, serverTarget, serveApp } from "./serve.ts";
import { Apps } from "./service.ts";
import { openRoute } from "./open.ts";

// The apps feature: app folders served, built or run, and forwarded ports.

export type AppsFeatureOptions = { workdir?: string; clock?: () => number };

function appRoutes(apps: () => Apps, kernel: () => Kernel): Route[] {
	const app: Route = {
		method: "ANY",
		prefix: "/app/",
		tokenOf: passInPath,
		serve: (ctx, req, res) => serveApp(ctx, apps(), req, res),
		upgrade(req, socket, head, door) {
			const asked = new URL(req.url ?? "/", "http://decks.local");
			const carried = passInPath(asked);
			const url = carried ? new URL(`${carried.path}${asked.search}`, asked) : asked;
			const at = parseAppPath(url.pathname);
			if (!at || !door.resolve(carried?.token ?? url.searchParams.get("pass") ?? undefined)) return void socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
			void apps().manifest(at.name)
				.then((manifest) => (manifest.kind === "server" ? serverTarget(apps(), at.name, manifest, at.inner, url.search) : undefined))
				.catch(() => undefined)
				.then((target) => (target ? upgradeTo(req, socket, head, target.port, target.path, target.base) : socket.end("HTTP/1.1 404 Not Found\r\n\r\n")));
		},
	};
	const forward = (prefix: string): Route => ({
		method: "ANY",
		prefix,
		serve: (ctx: Context, req, res) => serveForward(ctx, req, res),
		upgrade(req, socket, head, door) {
			const url = new URL(req.url ?? "/", "http://decks.local");
			const target = forwardTarget(url.pathname);
			if (!target || !door.resolve(url.searchParams.get("pass") ?? undefined)) return void socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
			upgradeTo(req, socket, head, target.port, target.path, "");
		},
	});
	return [app, forward("/node/"), forward("/rnode/"), openRoute(kernel)];
}

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
		start(given) {
			kernel = given;
			const workdir = options.workdir ?? join(given.machine(), "app-run", given.deckId());
			const env = (name: string): Record<string, string> => {
				const url = given.url();
				const token = given.callers.issue({ kind: "app", id: name, name }, "app server");
				return { ...(url ? { DECKS_URL: url } : {}), DECKS_TOKEN: token };
			};
			apps = new Apps(given.deck, given.store("apps"), { workdir, env, clock });
			const sweep = setInterval(() => void apps?.sleepUnseen(), 60_000);
			sweep.unref();
			return () => {
				clearInterval(sweep);
				apps?.stopAll();
			};
		},
	});
}

export default appsFeature();
