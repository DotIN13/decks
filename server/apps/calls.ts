import { calls, Refused, type Handled, type Infer, type shapes } from "../../protocol/index.ts";
import { handleAll, toDeckPath, type Context, type Kernel } from "../kernel/index.ts";
import { checkInBrowser } from "./check.ts";
import { appNames, APPS, folderOf, manifestOf, sourceFiles } from "./manifest.ts";
import { cloneApp, create, moveOut, setSource } from "./make.ts";
import { repoOf } from "./repo.ts";
import { WAIT_MS, type Apps } from "./service.ts";

// One short handler per app call. See the README's rules.

type App = Infer<typeof shapes.App>;
const { app } = calls;

/** An app as a call answers it: its manifest, its state, its repository. */
export async function describe(ctx: Context, apps: Apps, name: string, withRepo = false): Promise<App> {
	const manifest = await apps.manifest(name);
	const kept = await apps.stateOf(name, manifest);
	const inDeck = manifest.kind === "static" && !manifest.source;
	const files = inDeck ? await sourceFiles(ctx.deck, name) : [];
	const version = inDeck ? Math.max(0, ...files.map((one) => one.rev)) : kept.at;
	const errors = kept.status === "broken" ? await apps.logs.errors(name) : [];
	const repo = withRepo ? await repoOf(apps.machine.folder(name)) : undefined;
	return {
		name,
		title: manifest.title ?? name,
		kind: manifest.kind,
		status: kept.status,
		url: `/app/${name}/`,
		folder: folderOf(name),
		...(kept.port ? { port: kept.port } : {}),
		...(errors.length ? { errors } : kept.error ? { errors: [kept.error] } : {}),
		...(kept.seen ? { seen: kept.seen } : {}),
		...(kept.at ? { at: kept.at } : {}),
		...(version ? { version } : {}),
		...(repo ? { repo } : {}),
		...(manifest.source ? { source: manifest.source } : {}),
	};
}

/** Wait for a job up to 15 s, then answer the app as it is: its status says if it is still going. */
async function within(ctx: Context, apps: Apps, name: string, job: Promise<boolean>): Promise<App> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<"late">((done) => (timer = setTimeout(() => done("late"), WAIT_MS)));
	const got = await Promise.race([job, late]).finally(() => clearTimeout(timer));
	if (got === "late") ctx.note(`${name} is still going after ${WAIT_MS / 1000} s; app.get tells when it is done.`);
	return describe(ctx, apps, name);
}

/** Take every item showing the app off every canvas. */
async function unplace(ctx: Context, name: string): Promise<void> {
	const canvases = await ctx.call<{ name: string }[]>("canvas.list", {}).catch(() => []);
	for (const canvas of canvases) {
		const items = await ctx.call<{ id?: string; type: string; app?: string }[]>("item.list", { canvas: canvas.name, depth: 0 }).catch(() => []);
		for (const item of items) if (item.type === "app" && item.app === name && item.id) await ctx.call("item.delete", { id: item.id, canvas: canvas.name });
	}
}

async function check(ctx: Context, apps: Apps, kernel: Kernel, name: string): Promise<Infer<typeof shapes.AppCheck>> {
	await manifestOf(ctx.deck, name);
	const base = kernel.url();
	if (!base) throw new Refused("unavailable", "app.check needs the server's own address, and this server is not listening.", "app.logs");
	const id = `${name}.check`;
	const pass = kernel.callers.issue({ kind: "app", id, name }, "app.check");
	try {
		return await checkInBrowser(`${base}/app/t/${encodeURIComponent(pass)}/${name}/`, `/app/${name}/`);
	} finally {
		kernel.callers.revoke(id);
		apps.seen(name);
	}
}

export function appCalls(apps: () => Apps, kernel: () => Kernel): Handled<Context>[] {
	const A = { list: app.list, get: app.get, create: app.create, update: app.update, clone: app.clone, move: app.move, build: app.build, run: app.run, stop: app.stop, restart: app.restart, remove: app.remove, logs: app.logs, check: app.check };
	return handleAll(A, {
		list: async (ctx) => Promise.all((await appNames(ctx.deck)).map((name) => describe(ctx, apps(), name))),
		get: (ctx, { name }) => describe(ctx, apps(), name, true),
		create: (ctx, { name, starter, title, source }) => create(ctx, apps(), describe, { name, starter: starter ?? "static", ...(title ? { title } : {}), ...(source ? { source } : {}) }),
		update: async (ctx, { name, seen, source }) => {
			await manifestOf(ctx.deck, name);
			if (source) await setSource(ctx, apps(), name, source);
			if (seen !== undefined) apps().set(name, { seen });
			return describe(ctx, apps(), name);
		},
		clone: (ctx, { url, name, title, to }) => cloneApp(ctx, apps(), describe, { url, ...(name ? { name } : {}), ...(title ? { title } : {}), ...(to ? { to } : {}) }),
		move: (ctx, { name, to }) => moveOut(ctx, apps(), describe, name, to),
		build: async (ctx, { name }) => within(ctx, apps(), name, apps().build(name)),
		run: async (ctx, { name }) => within(ctx, apps(), name, apps().run(name)),
		stop: async (ctx, { name }) => {
			await manifestOf(ctx.deck, name);
			if (!apps().stop(name)) ctx.note(`${name} was not running.`);
			return describe(ctx, apps(), name);
		},
		restart: async (ctx, { name }) => {
			await manifestOf(ctx.deck, name);
			apps().stop(name);
			return within(ctx, apps(), name, apps().run(name));
		},
		remove: async (ctx, { name }) => {
			await manifestOf(ctx.deck, name);
			await apps().forget(name);
			apps().machine.place(name, undefined);
			await unplace(ctx, name);
			await ctx.deck.remove(folderOf(name), ctx.caller);
			return { deleted: `${APPS}/${name}` };
		},
		logs: async (ctx, { name, tail }) => {
			await manifestOf(ctx.deck, name);
			return apps().logs.tail(name, tail ?? 200);
		},
		check: (ctx, { name }) => check(ctx, apps(), kernel(), name),
	});
}
