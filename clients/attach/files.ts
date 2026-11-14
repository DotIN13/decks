import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

// Writes a plan of files into a folder and records how to undo it in
// .decks-attach.json: the files it made, the folders it made, and what each
// file it changed held before. undo() puts the folder back as it was.

export const MANIFEST = ".decks-attach.json";

/** One file: whole new text, or a change to the JSON already there. */
export type Planned = { path: string; text?: string; merge?: (old: Record<string, unknown>) => Record<string, unknown>; mode?: number };
export type Manifest = { tool: string; agent: string; url: string; made: string[]; dirs: string[]; before: Record<string, string> };

function makeDirs(root: string, dir: string, dirs: string[]): void {
	if (existsSync(dir)) return;
	makeDirs(root, dirname(dir), dirs);
	mkdirSync(dir);
	dirs.push(relative(root, dir));
}

export function apply(root: string, plan: Planned[], meta: { tool: string; agent: string; url: string }): Manifest {
	if (existsSync(join(root, MANIFEST))) throw new Error(`${root} is already attached: run decks detach first.`);
	const manifest: Manifest = { ...meta, made: [], dirs: [], before: {} };
	for (const one of plan) {
		const path = join(root, one.path);
		makeDirs(root, dirname(path), manifest.dirs);
		const old = existsSync(path) ? readFileSync(path, "utf8") : undefined;
		if (old === undefined) manifest.made.push(one.path);
		else manifest.before[one.path] = old;
		const text = one.merge ? `${JSON.stringify(one.merge(old ? (JSON.parse(old) as Record<string, unknown>) : {}), null, "\t")}\n` : (one.text ?? "");
		writeFileSync(path, text);
		if (one.mode) chmodSync(path, one.mode);
	}
	writeFileSync(join(root, MANIFEST), `${JSON.stringify(manifest, null, "\t")}\n`, { mode: 0o600 });
	return manifest;
}

export function readManifest(root: string): Manifest {
	const file = join(root, MANIFEST);
	if (!existsSync(file)) throw new Error(`${root} is not attached: there is no ${MANIFEST}.`);
	return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

/** Remove what apply made, put back what it changed, and drop the folders it made if empty. */
export function undo(root: string, manifest: Manifest): void {
	for (const path of manifest.made) rmSync(join(root, path), { force: true });
	for (const [path, text] of Object.entries(manifest.before)) writeFileSync(join(root, path), text);
	for (const dir of [...manifest.dirs].reverse()) {
		const full = join(root, dir);
		if (existsSync(full) && readdirSync(full).length === 0) rmdirSync(full);
	}
	rmSync(join(root, MANIFEST), { force: true });
}
