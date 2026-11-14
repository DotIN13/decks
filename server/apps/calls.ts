import { calls, Refused, type Handled, type Infer, type shapes } from "../../protocol/index.ts";
import { handleAll, toDeckPath, type Context, type Kernel } from "../kernel/index.ts";
import { checkInBrowser } from "./check.ts";
import { appNames, APPS, folderOf, manifestOf, parseManifest, sourceFiles } from "./manifest.ts";
import { clone, commitAll, nameFromUrl, repoOf } from "./repo.ts";
import { WAIT_MS, type Apps } from "./service.ts";
import { starterFiles, type Starter } from "./starters.ts";

// One short handler per app call. Rules 1 to 12 of the README.

type App = Infer<typeof shapes.App>;
const { app } = calls;
const encode = (text: string) => new TextEncoder().encode(text);

/** An app as a call answers it: its manifest, its state, its repository. */
export async function describe(ctx: Context, apps: Apps, name: string, withRepo = false): Promise<App> {
	const manifest = await manifestOf(ctx.deck, name);
	const kept = await apps.stateOf(name, manifest);
	const files = manifest.kind === "static" ? await sourceFiles(ctx.deck, name) : [];
	const version = manifest.kind === "static" ? Math.max(0, ...files.map((one) => one.rev)) : kept.at;
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

async function hasFiles(ctx: Context, name: string): Promise<boolean> {
	return (await ctx.deck.list(folderOf(name)).catch(() => [])).length > 0;
}

/** Write a set of files into the app's folder in the deck, as the caller. */
async function writeAll(ctx: Context, name: string, files: Record<string, Uint8Array>): Promise<void> {
	for (const [path, bytes] of Object.entries(files)) await ctx.deck.write(toDeckPath(`${folderOf(name)}/${path}`), bytes, ctx.caller);
}

async function create(ctx: Context, apps: Apps, name: string, starter: Starter, title?: string): Promise<App> {
	if (await hasFiles(ctx, name)) throw new Refused("conflict", `apps/${name} already has files; an app is made in a new folder.`, "app.get");
	const files = starterFiles(starter, title ?? name);
	await writeAll(ctx, name, Object.fromEntries(Object.entries(files).map(([path, text]) => [path, encode(text)])));
	await apps.sync(name);
	await commitAll(apps.machine.folder(name), `Start ${name} from the ${starter} starter`).catch((error: Error) => ctx.note(`No git repository: ${error.message}`));
	return describe(ctx, apps, name, true);
}

/** The kind a cloned folder with no app.json is, from its package.json. */
function guessManifest(title: string, pkg: string | undefined): string {
	let scripts: Record<string, unknown> = {};
	try {
		scripts = (JSON.parse(pkg ?? "{}") as { scripts?: Record<string, unknown> }).scripts ?? {};
	} catch {
		scripts = {};
	}
	const kind = scripts.start ? "server" : scripts.build ? "build" : "static";
	return `${JSON.stringify({ title, kind }, null, "\t")}\n`;
}

async function cloneApp(ctx: Context, apps: Apps, url: string, given?: string, title?: string): Promise<App> {
	const name = given ?? nameFromUrl(url);
	folderOf(name);
	if ((await hasFiles(ctx, name)) || (await apps.machine.isDir(name, "."))) throw new Refused("conflict", `An app called ${name} is here already; give another name.`, "app.list");
	await clone(url, apps.machine.workdir, name);
	const files: Record<string, Uint8Array> = {};
	for (const path of await apps.machine.files(name)) files[path] = (await apps.machine.read(name, path))!;
	if (!files["app.json"]) {
		const pkg = files["package.json"] ? new TextDecoder().decode(files["package.json"]) : undefined;
		files["app.json"] = encode(guessManifest(title ?? name, pkg));
		ctx.note(`${url} had no app.json; one was written from its package.json.`);
	}
	parseManifest(name, new TextDecoder().decode(files["app.json"]));
	await writeAll(ctx, name, files);
	return describe(ctx, apps, name, true);
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
	const pass = kernel.callers.issue({ kind: "app", id: name, name }, "app.check");
	try {
		return await checkInBrowser(`${base}/app/${name}/?pass=${encodeURIComponent(pass)}`, `/app/${name}/`);
	} finally {
		kernel.callers.revoke(name);
		apps.seen(name);
	}
}

export function appCalls(apps: () => Apps, kernel: () => Kernel): Handled<Context>[] {
	const A = { list: app.list, get: app.get, create: app.create, update: app.update, clone: app.clone, build: app.build, run: app.run, stop: app.stop, restart: app.restart, remove: app.remove, logs: app.logs, check: app.check };
	return handleAll(A, {
		list: async (ctx) => Promise.all((await appNames(ctx.deck)).map((name) => describe(ctx, apps(), name))),
		get: (ctx, { name }) => describe(ctx, apps(), name, true),
		create: (ctx, { name, starter, title }) => create(ctx, apps(), name, starter ?? "static", title),
		update: async (ctx, { name, seen }) => {
			await manifestOf(ctx.deck, name);
			apps().set(name, { seen });
			return describe(ctx, apps(), name);
		},
		clone: (ctx, { url, name, title }) => cloneApp(ctx, apps(), url, name, title),
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
