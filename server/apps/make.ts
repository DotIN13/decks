import { basename, dirname } from "node:path";
import { Refused, type Infer, type shapes } from "../../protocol/index.ts";
import { toDeckPath, type Context } from "../kernel/index.ts";
import { folderOf, manifestOf, parseManifest, sourceFiles } from "./manifest.ts";
import { clone, commitAll, nameFromUrl, repoOf } from "./repo.ts";
import type { Apps } from "./service.ts";
import { outsideFolder, personOnly, type Source } from "./source.ts";
import { starterFiles, type Starter } from "./starters.ts";

// Making an app: from a starter, by cloning, or moving its source out of the deck.
// A source outside the deck (rules 15 to 18) is named only by the person.

type App = Infer<typeof shapes.App>;
type Describe = (ctx: Context, apps: Apps, name: string, withRepo?: boolean) => Promise<App>;
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

async function hasRecord(ctx: Context, name: string): Promise<boolean> {
	return (await ctx.deck.list(folderOf(name)).catch(() => [])).length > 0;
}

async function writeAll(ctx: Context, name: string, files: Record<string, Uint8Array>): Promise<void> {
	for (const [path, bytes] of Object.entries(files)) await ctx.deck.write(toDeckPath(`${folderOf(name)}/${path}`), bytes, ctx.caller);
}

/** app.json's text with source set, every other field kept as written. */
function withSource(json: string, source: Source): Uint8Array {
	const raw = JSON.parse(json) as Record<string, unknown>;
	return encode(`${JSON.stringify({ ...raw, source }, null, "\t")}\n`);
}

/** A folder an outside app may take: missing, or empty. */
async function freeFolder(apps: Apps, raw: string): Promise<string> {
	const path = outsideFolder(raw);
	const seen = await apps.machine.look(path);
	if (seen.entries > 0) throw new Refused("conflict", `${path} already has files; an app is made in a new or empty folder.`, "app.move");
	return path;
}

export async function create(ctx: Context, apps: Apps, describe: Describe, args: { name: string; starter: Starter; title?: string; source?: Source }): Promise<App> {
	const { name, starter } = args;
	if (await hasRecord(ctx, name)) throw new Refused("conflict", `apps/${name} already has files; an app is made in a new folder.`, "app.get");
	const files = Object.fromEntries(Object.entries(starterFiles(starter, args.title ?? name)).map(([path, text]) => [path, encode(text)]));
	if (args.source) {
		personOnly(ctx.caller, "an app's source folder", "app.create");
		const path = await freeFolder(apps, args.source.path);
		apps.machine.place(name, path);
		for (const [file, bytes] of Object.entries(files)) await apps.machine.put(name, file, bytes);
		await writeAll(ctx, name, { "app.json": withSource(decode(files["app.json"]!), { ...args.source, path }) });
	} else {
		await writeAll(ctx, name, files);
		await apps.sync(name);
	}
	await commitAll(apps.machine.folder(name), `Start ${name} from the ${starter} starter`).catch((error: Error) => ctx.note(`No git repository: ${error.message}`));
	return describe(ctx, apps, name, true);
}

/** The kind a cloned folder with no app.json is, from its package.json. */
export function guessManifest(title: string, pkg: string | undefined): string {
	let scripts: Record<string, unknown> = {};
	try {
		scripts = (JSON.parse(pkg ?? "{}") as { scripts?: Record<string, unknown> }).scripts ?? {};
	} catch {
		scripts = {};
	}
	return `${JSON.stringify({ title, kind: scripts.start ? "server" : scripts.build ? "build" : "static" }, null, "\t")}\n`;
}

export async function cloneApp(ctx: Context, apps: Apps, describe: Describe, args: { url: string; name?: string; title?: string; to?: string }): Promise<App> {
	const name = args.name ?? nameFromUrl(args.url);
	folderOf(name);
	if (await hasRecord(ctx, name)) throw new Refused("conflict", `An app called ${name} is here already; give another name.`, "app.list");
	if (args.to) personOnly(ctx.caller, "the folder an app is cloned into", "app.clone");
	const outside = args.to ? await freeFolder(apps, args.to) : undefined;
	if (!outside && (await apps.machine.isDir(name, "."))) throw new Refused("conflict", `An app called ${name} is here already; give another name.`, "app.list");
	await clone(args.url, outside ? dirname(outside) : apps.machine.workdir, outside ? basename(outside) : name);
	apps.machine.place(name, outside);
	const files: Record<string, Uint8Array> = {};
	for (const path of await apps.machine.files(name)) files[path] = (await apps.machine.read(name, path))!;
	let json = files["app.json"] ? decode(files["app.json"]) : guessManifest(args.title ?? name, files["package.json"] ? decode(files["package.json"]) : undefined);
	if (!files["app.json"]) ctx.note(`${args.url} had no app.json; one was written from its package.json.`);
	parseManifest(name, json);
	if (outside) json = decode(withSource(json, { path: outside, repo: args.url }));
	await writeAll(ctx, name, outside ? { "app.json": encode(json) } : { ...files, "app.json": encode(json) });
	return describe(ctx, apps, name, true);
}

/** app.update's source: point the record at another folder; refused from anyone but the person. */
export async function setSource(ctx: Context, apps: Apps, name: string, source: Source): Promise<void> {
	personOnly(ctx.caller, "an app's source folder", "app.update");
	const manifest = await manifestOf(ctx.deck, name);
	if (!manifest.source) throw new Refused("invalid", `${name}'s source is in the deck; app.move takes it out.`, "app.move");
	const record = toDeckPath(`${folderOf(name)}/app.json`);
	apps.stop(name);
	await ctx.deck.write(record, withSource(decode(await ctx.deck.read(record)), { ...source, path: outsideFolder(source.path) }), ctx.caller);
}

/** app.move: the source leaves the deck for a folder; the deck keeps the record. */
export async function moveOut(ctx: Context, apps: Apps, describe: Describe, name: string, to: string): Promise<App> {
	personOnly(ctx.caller, "the folder an app moves to", "app.move");
	const manifest = await apps.manifest(name);
	if (manifest.source) throw new Refused("conflict", `${name} already lives in ${manifest.source.path}; app.update with source points it elsewhere.`, "app.update");
	const path = await freeFolder(apps, to);
	const repo = (await repoOf(apps.machine.folder(name)))?.remote;
	apps.stop(name);
	const files = await sourceFiles(ctx.deck, name);
	apps.machine.place(name, path);
	for (const file of files) await apps.machine.put(name, file.path, await ctx.deck.read(toDeckPath(`${folderOf(name)}/${file.path}`)));
	const record = toDeckPath(`${folderOf(name)}/app.json`);
	await ctx.deck.write(record, withSource(decode(await ctx.deck.read(record)), { path, ...(repo ? { repo } : {}) }), ctx.caller);
	for (const file of files) if (file.path !== "app.json") await ctx.deck.remove(toDeckPath(`${folderOf(name)}/${file.path}`), ctx.caller);
	await commitAll(path, `Move ${name} out of the deck`).catch((error: Error) => ctx.note(`No git repository: ${error.message}`));
	ctx.note(`${name} now lives in ${path}: edit its files there, on disk; file calls see only its record.`);
	return describe(ctx, apps, name, true);
}
