import { Refused } from "../../protocol/index.ts";
import { toDeckPath, type Deck, type DeckPath } from "../kernel/index.ts";

// An app's name and app.json, read from the deck. Rules 1 and 2 of the README.

export type AppKind = "static" | "build" | "server";
export type Manifest = { title?: string; kind: AppKind; root?: string; install?: string; build?: string; start?: string; prefix?: boolean; idleMinutes?: number };

export const APP_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const APPS = "apps";

/** The app's folder in the deck; a bad name is refused as invalid. */
export function folderOf(name: string): DeckPath {
	if (!APP_NAME.test(name)) throw new Refused("invalid", `An app's name is lower-case letters, digits and dashes, as in "trip-planner"; not ${JSON.stringify(name)}.`, "app.list");
	return toDeckPath(`${APPS}/${name}`);
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** app.json's fields, each checked; anything else is dropped. */
export function parseManifest(name: string, raw: string): Manifest {
	let read: Record<string, unknown>;
	try {
		read = (JSON.parse(raw) ?? {}) as Record<string, unknown>;
	} catch (error) {
		throw new Refused("invalid", `apps/${name}/app.json is not JSON: ${(error as Error).message}`, "file.read");
	}
	const kind: AppKind = read.kind === "build" || read.kind === "server" ? read.kind : "static";
	const manifest: Manifest = { kind };
	for (const field of ["title", "root", "install", "build", "start"] as const) {
		const value = text(read[field]);
		if (value) manifest[field] = value;
	}
	if (read.prefix === true) manifest.prefix = true;
	if (typeof read.idleMinutes === "number" && read.idleMinutes > 0) manifest.idleMinutes = read.idleMinutes;
	if (manifest.root && (manifest.root.startsWith("/") || manifest.root.split("/").includes(".."))) {
		throw new Refused("invalid", `apps/${name}/app.json names a root outside the app.`, "file.edit");
	}
	return manifest;
}

/** The manifest, or not_found when the folder has no app.json. */
export async function manifestOf(deck: Deck, name: string): Promise<Manifest> {
	const file = toDeckPath(`${folderOf(name)}/app.json`);
	const bytes = await deck.read(file).catch(() => undefined);
	if (!bytes) throw new Refused("not_found", `There is no app called ${name}: apps/${name}/app.json is missing.`, "app.list");
	return parseManifest(name, new TextDecoder().decode(bytes));
}

/** The names of every folder in apps/ that holds an app.json. */
export async function appNames(deck: Deck): Promise<string[]> {
	const entries = await deck.list(toDeckPath(APPS)).catch(() => []);
	const names: string[] = [];
	for (const entry of entries) {
		const name = entry.path.slice(APPS.length + 1);
		if (entry.kind !== "dir" || !APP_NAME.test(name)) continue;
		if (await deck.read(toDeckPath(`${entry.path}/app.json`)).then(() => true, () => false)) names.push(name);
	}
	return names.sort();
}

/** Every file of an app's source, deepest included, with its revision. */
export async function sourceFiles(deck: Deck, name: string): Promise<{ path: string; rev: number }[]> {
	const root = folderOf(name);
	const out: { path: string; rev: number }[] = [];
	const walk = async (dir: DeckPath): Promise<void> => {
		for (const entry of await deck.list(dir).catch(() => [])) {
			if (entry.kind === "dir") {
				if (!entry.path.endsWith("/node_modules")) await walk(entry.path);
			} else out.push({ path: entry.path.slice(root.length + 1), rev: entry.rev ?? 0 });
		}
	};
	await walk(root);
	return out.sort((a, b) => a.path.localeCompare(b.path));
}
