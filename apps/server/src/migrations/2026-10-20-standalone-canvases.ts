import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, sep } from "node:path";
import { canvasFolder, isHidden, plainSegment, urlFor } from "../deck/layout.ts";

/**
 * 2026-10-20: every canvas becomes a folder that stands alone (`deck/layout.ts`).
 *
 * Before, a deck's boards were the deck's, in `boards/`, and any canvas placed any of them by its
 * deck path (`"../../boards/plan.html"`); saved frames were in the deck's `frames/`. After, each
 * canvas keeps the boards it places in `canvases/<name>/boards/`, the frames it uses in its
 * `frames/`, and the pictures and files its boards use in its `files/`, so sharing a canvas is
 * copying one folder.
 *
 * What it does, in order, and nothing before the backup:
 *
 * 1. a zip of the whole deck, but apps' `node_modules` and earlier backups, in `.decks/backups/`;
 * 2. per canvas, each board it places is moved into its `boards/`, or copied when it is on several
 *    canvases (one copy per canvas); a board kept in another canvas's own folder is copied too;
 * 3. the files a moved board uses come along: a sibling in the library that is not a board (a
 *    stylesheet, a script) beside it in the canvas's `boards/`; anything from the deck's `assets/`
 *    into the canvas's `files/`, and from any other folder of the deck (`exports/`, `scripts/`) into
 *    `files/<folder>/`, its link rewritten; `lib/`, `docs/` and `apps/` stay, served beside the
 *    canvas's boards (`deck/layout.ts`); a link to a board on another canvas goes to its new place,
 *    and one to a board on no canvas to the library, where it stays;
 * 4. frames the drawing uses are copied into its `frames/`, and pictures it fills with into `files/`;
 * 5. the drawing names each board relative to its folder (`boards/plan.html`);
 * 6. what was kept per board path is kept under the new paths: who wrote it and when it was seen,
 *    its versions, its pictures, whether it may run its code, and each agent's records;
 * 7. boards and frames no canvas places stay where they are, a library that is read and copied
 *    from; the app boards (`boards/apps/`) stay too, as every app's own board.
 *
 * It runs once, at start (`migrations/index.ts`), and says so in `.decks/migrations.json`. A dry run
 * (`DECKS_MIGRATE_DRY_RUN=1`, or `npm run migrate -- --dry-run <deck>`) works out every move and
 * prints it, and writes nothing.
 */
export const MIGRATION = "2026-10-20-standalone-canvases";

export type Step =
	| { kind: "backup"; to: string }
	| { kind: "move" | "copy"; from: string; to: string; canvas: string }
	| { kind: "file"; from: string; to: string; canvas: string }
	| { kind: "frame"; from: string; to: string; canvas: string }
	| { kind: "links"; board: string; links: Array<{ from: string; to: string }> }
	| { kind: "drawing"; canvas: string; boards: number }
	| { kind: "records"; what: string; count: number }
	| { kind: "skip"; what: string; why: string };

export interface Plan {
	deck: string;
	canvases: number;
	placed: number;
	copies: number;
	steps: Step[];
	/** Old board path → its new paths, one per canvas placing it. */
	moved: Map<string, string[]>;
	/** Per canvas, old board path → its new path there. */
	byCanvas: Map<string, Map<string, string>>;
}

interface BoardNode {
	type?: string;
	id?: string;
	url?: string;
	ref?: string;
	metadata?: { type?: string; path?: string };
	children?: BoardNode[];
	[key: string]: unknown;
}

const BOARD_ITEM = "decks.board";
const BOARD_FILE = /\.(?:x?html?|mdx?)$/i;
/** A link a board's text may hold: in quotes, in `url(…)` or a markdown link, with a file extension. */
const LINK = /(["'(])((?:\.{1,2}\/)*[A-Za-z0-9_ -￿][^"'()\s<>?#|*:]*\.[A-Za-z0-9]{1,8})(?=[?#"')])/g;

const toPosix = (path: string) => path.split(sep).join("/");
const readJson = <T>(file: string): T | undefined => {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as T;
	} catch {
		return undefined;
	}
};

/** Whether this deck has run the migration already. */
export function migrated(deck: string): boolean {
	return !!readJson<Record<string, unknown>>(join(deck, ".decks", "migrations.json"))?.[MIGRATION];
}

/** The canvases to migrate: folders under `canvases/` with a drawing that parses. */
function canvasesOf(deck: string, steps: Step[]): Array<{ name: string; doc: { children?: BoardNode[] }; text: string }> {
	const dir = join(deck, "canvases");
	if (!existsSync(dir)) return [];
	const out: Array<{ name: string; doc: { children?: BoardNode[] }; text: string }> = [];
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isDirectory() || !plainSegment(entry.name)) continue;
		const file = join(dir, entry.name, "canvas.pen");
		if (!existsSync(file)) continue;
		const text = readFileSync(file, "utf8");
		try {
			out.push({ name: entry.name, doc: JSON.parse(text) as { children?: BoardNode[] }, text });
		} catch {
			steps.push({ kind: "skip", what: `canvases/${entry.name}/canvas.pen`, why: "it does not parse; fix it and its boards stay where they are" });
		}
	}
	return out;
}

function* nodes(list: BoardNode[] | undefined): Generator<BoardNode> {
	for (const node of list ?? []) {
		yield node;
		if (Array.isArray(node.children)) yield* nodes(node.children);
	}
}

const boardPathOf = (node: BoardNode): string | undefined => (node.type === "browser" && node.metadata?.type === BOARD_ITEM && typeof node.metadata.path === "string" && node.metadata.path ? node.metadata.path : undefined);

/** Where a board sits inside its folder: `boards/x/a.html` is `x/a.html`, a canvas's own `canvases/n/boards/a.html` is `a.html`. */
function insideBoards(path: string): string | undefined {
	const library = /^boards\/(.+)$/.exec(path);
	if (library) return library[1];
	const own = /^canvases\/[^/]+\/boards\/(.+)$/.exec(path);
	return own?.[1];
}

/** Every `ref` in a document and the frames under it, as `frames/<name>` or `boards/<name>` (a `.pen` placed by ref). */
function frameRefs(value: unknown, out = new Set<string>()): Set<string> {
	if (Array.isArray(value)) for (const one of value) frameRefs(one, out);
	else if (value && typeof value === "object") {
		const ref = (value as { ref?: unknown }).ref;
		if (typeof ref === "string") {
			const found = /^((?:frames|boards)\/[A-Za-z0-9][\w.-]*(?:\/[A-Za-z0-9][\w.-]*)*)(?::|$)/.exec(ref);
			if (found) out.add(found[1]!);
		}
		for (const inner of Object.values(value)) if (inner && typeof inner === "object") frameRefs(inner, out);
	}
	return out;
}

/** Work out every move, reading only. */
export function planStandalone(deck: string): Plan {
	const steps: Step[] = [];
	const canvases = canvasesOf(deck, steps);
	const placedOn = new Map<string, string[]>();
	for (const { name, doc } of canvases) {
		for (const node of nodes(doc.children)) {
			const path = boardPathOf(node);
			if (!path) continue;
			const list = placedOn.get(path) ?? [];
			if (!list.includes(name)) list.push(name);
			placedOn.set(path, list);
		}
	}
	const byCanvas = new Map<string, Map<string, string>>();
	const moved = new Map<string, string[]>();
	let copies = 0;
	const taken = new Set<string>();
	for (const [path, on] of [...placedOn].sort(([a], [b]) => a.localeCompare(b))) {
		const inside = insideBoards(path);
		for (const name of on) {
			const map = byCanvas.get(name) ?? new Map<string, string>();
			byCanvas.set(name, map);
			if (path.startsWith(`canvases/${name}/boards/`)) {
				map.set(path, path);
				continue;
			}
			if (!inside) {
				steps.push({ kind: "skip", what: `${path} on ${name}`, why: "it is not a board in a board folder; the canvas keeps pointing at it" });
				continue;
			}
			let target = `canvases/${name}/boards/${inside}`;
			for (let n = 2; taken.has(target) || (existsSync(join(deck, target)) && target !== path); n++) target = `canvases/${name}/boards/${inside.replace(/(\.[^./]+)$/, `-${n}$1`)}`;
			taken.add(target);
			map.set(path, target);
			moved.set(path, [...(moved.get(path) ?? []), target]);
		}
	}
	for (const [path, targets] of moved) {
		const exists = existsSync(join(deck, path));
		const keep = !path.startsWith("boards/") || path.startsWith("boards/apps/") || !exists;
		targets.forEach((to, i) => {
			const name = /^canvases\/([^/]+)\//.exec(to)![1]!;
			const kind = !exists ? "skip" : keep || i < targets.length - 1 ? "copy" : "move";
			if (kind === "skip") steps.push({ kind: "skip", what: `${path} on ${name}`, why: "the board's file is not there; the canvas names it as its own, and it shows as missing" });
			else steps.push({ kind, from: path, to, canvas: name });
			if (kind === "copy" && targets.length > 1) copies += 1;
		});
	}
	const plan: Plan = { deck, canvases: canvases.length, placed: placedOn.size, copies, steps, moved, byCanvas };
	// The files each moved board uses, and its links.
	for (const step of [...steps]) {
		if (step.kind !== "move" && step.kind !== "copy") continue;
		const links = linksOf(deck, step.from, step.to, step.canvas, plan, steps);
		if (links.length) steps.push({ kind: "links", board: step.to, links });
	}
	// Frames, and the pictures a drawing fills with.
	for (const { name, doc } of canvases) {
		const refs = [...frameRefs(doc.children)];
		const seen = new Set<string>();
		while (refs.length) {
			const ref = refs.pop()!;
			if (seen.has(ref)) continue;
			seen.add(ref);
			const from = `${ref}.pen`;
			if (!existsSync(join(deck, from))) continue;
			const to = `canvases/${name}/${from}`;
			if (!existsSync(join(deck, to))) steps.push({ kind: "frame", from, to, canvas: name });
			const inner = readJson(join(deck, from));
			if (inner) refs.push(...frameRefs(inner));
		}
		for (const node of nodes(doc.children)) {
			if (boardPathOf(node)) continue;
			for (const url of fillUrls(node)) {
				const target = posix.normalize(posix.join(`canvases/${name}`, url));
				if (target.startsWith("..") || target.startsWith(`canvases/${name}/`) || isHidden(target) || !existsSync(join(deck, target))) continue;
				addFile(plan, steps, target, name);
			}
		}
		steps.push({ kind: "drawing", canvas: name, boards: byCanvas.get(name)?.size ?? 0 });
	}
	return plan;
}

/** The addresses an item's fills give, relative to the canvas's folder (an image fill's `url`). */
function fillUrls(node: BoardNode): string[] {
	const out: string[] = [];
	const scan = (value: unknown, key?: string) => {
		if (typeof value === "string" && key === "url" && !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value)) out.push(value);
		else if (Array.isArray(value)) value.forEach((one) => scan(one));
		else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) if (k !== "children") scan(v, k);
	};
	for (const [key, value] of Object.entries(node)) if (key !== "children" && key !== "metadata") scan(value, key);
	return out;
}

/** Where a deck file a canvas's board uses lands in its `files/`: `assets/a/b.png` → `files/a/b.png`, `exports/x.mp4` → `files/exports/x.mp4`. */
function filesPathFor(deckPath: string): string {
	return deckPath.startsWith("assets/") ? `files/${deckPath.slice("assets/".length)}` : `files/${deckPath}`;
}

/** A deck file copied into a canvas's `files/`, once, and the canvas path it is at. */
function addFile(plan: Plan, steps: Step[], deckPath: string, canvas: string): string {
	const to = `canvases/${canvas}/${filesPathFor(deckPath)}`;
	if (!steps.some((one) => one.kind === "file" && one.to === to)) steps.push({ kind: "file", from: deckPath, to, canvas });
	return to;
}

/**
 * The links in a board that change when it moves from `from` to `to` on `canvas`, and the files it
 * uses that come with it (pushed onto `steps`). Only a link to a file that is there is touched: text
 * that only looks like a path is left as it is.
 */
function linksOf(deck: string, from: string, to: string, canvas: string, plan: Plan, steps: Step[]): Array<{ from: string; to: string }> {
	let text: string;
	try {
		text = readFileSync(join(deck, from), "utf8");
	} catch {
		return [];
	}
	const out: Array<{ from: string; to: string }> = [];
	const seen = new Set<string>();
	const fromDir = posix.dirname(from);
	const toDir = posix.dirname(to);
	for (const match of text.matchAll(LINK)) {
		const link = match[2]!;
		if (seen.has(link)) continue;
		seen.add(link);
		const target = posix.normalize(posix.join(fromDir, link));
		if (target.startsWith("../") || target === ".." || isHidden(target)) continue;
		let full: string;
		try {
			full = join(deck, target);
			if (!statSync(full).isFile()) continue;
		} catch {
			continue;
		}
		const place = newPlaceOf(target, canvas, plan, steps, deck);
		if (!place) continue;
		let next = posix.relative(toDir, place);
		if (link.startsWith("./") && !next.startsWith(".")) next = `./${next}`;
		if (next !== link) out.push({ from: link, to: next });
	}
	return out;
}

/** Where a file a board uses is after the move, deck-relative, as the board on `canvas` should reach it. */
function newPlaceOf(target: string, canvas: string, plan: Plan, steps: Step[], deck: string): string | undefined {
	const top = target.split("/")[0]!;
	const here = `canvases/${canvas}`;
	// The runtime and the deck's docs and apps: served beside the canvas's boards (`deck/layout.ts`).
	if (top === "lib" || top === "docs" || top === "apps") return `${here}/${target}`;
	if (top === "canvases") {
		const own = /^canvases\/([^/]+)\//.exec(target)?.[1];
		if (own === canvas) return target;
		// A board in another canvas's folder, placed here too: its copy here; else where it is.
		return plan.byCanvas.get(canvas)?.get(target) ?? target;
	}
	if (top === "boards") {
		const onHere = plan.byCanvas.get(canvas)?.get(target);
		if (onHere) return onHere;
		if (BOARD_FILE.test(target)) {
			// A board on other canvases: the copy on the first of them. On none: the library, where it stays.
			const elsewhere = plan.moved.get(target)?.[0];
			if (elsewhere && !target.startsWith("boards/apps/")) return elsewhere;
			return target;
		}
		// A stylesheet, a script or a picture beside the boards: beside this canvas's copy too.
		const to = `${here}/${target}`;
		if (!steps.some((one) => one.kind === "file" && one.to === to)) steps.push({ kind: "file", from: target, to, canvas });
		return to;
	}
	if (top === "shared") return target;
	// The deck's assets/, and any other folder of it: copied into the canvas's files/.
	if (!existsSync(join(deck, target))) return undefined;
	return addFile(plan, steps, target, canvas);
}

/** The lines a dry run prints: every move, then the totals. */
export function describe(plan: Plan): string[] {
	const lines: string[] = [];
	for (const step of plan.steps) {
		switch (step.kind) {
			case "backup":
				lines.push(`backup   the deck → ${step.to}`);
				break;
			case "move":
			case "copy":
				lines.push(`${step.kind.padEnd(8)} ${step.from} → ${step.to}`);
				break;
			case "file":
				lines.push(`file     ${step.from} → ${step.to}`);
				break;
			case "frame":
				lines.push(`frame    ${step.from} → ${step.to}`);
				break;
			case "links":
				for (const link of step.links) lines.push(`link     ${step.board}: ${link.from} → ${link.to}`);
				break;
			case "drawing":
				lines.push(`drawing  canvases/${step.canvas}/canvas.pen: ${step.boards} boards named from its own folder`);
				break;
			case "records":
				lines.push(`records  ${step.what}: ${step.count}`);
				break;
			case "skip":
				lines.push(`skip     ${step.what}: ${step.why}`);
				break;
		}
	}
	const count = (kind: Step["kind"]) => plan.steps.filter((one) => one.kind === kind).length;
	lines.push(`${plan.canvases} canvases, ${plan.placed} boards placed on them: ${count("move")} moved, ${count("copy")} copied, ${count("file")} files and ${count("frame")} frames brought along, ${count("skip")} left as they were.`);
	return lines;
}

export interface MigrateOptions {
	dryRun?: boolean;
	/** The install's data folder, where `board-eval.json` (the Allow decisions) is kept. */
	dataDir?: string;
	log?: (line: string) => void;
	now?: Date;
}

/** Run the migration, once: back up, move, rewrite, re-key, and record. Answers the plan, and whether anything was written. */
export function migrateStandalone(deck: string, options: MigrateOptions = {}): { plan: Plan; ran: boolean; backup?: string } {
	const log = options.log ?? (() => {});
	const plan = planStandalone(deck);
	if (options.dryRun) {
		for (const line of describe(plan)) log(line);
		return { plan, ran: false };
	}
	if (migrated(deck)) return { plan, ran: false };
	const now = options.now ?? new Date();
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	const nothing = plan.canvases === 0 && !existsSync(join(deck, "frames"));
	const backup = nothing ? undefined : backUp(deck, `.decks/backups/${stamp}-before-standalone-canvases.zip`);
	if (backup) log(`backed the deck up to ${backup}`);
	run(deck, plan);
	rekey(deck, plan, options.dataDir, log);
	record(deck, { at: now.toISOString(), ...(backup ? { backup } : {}), canvases: plan.canvases, placed: plan.placed, moved: plan.steps.filter((one) => one.kind === "move").length, copied: plan.steps.filter((one) => one.kind === "copy").length });
	return { plan, ran: true, ...(backup ? { backup } : {}) };
}

/**
 * A zip of the deck, apps' `node_modules` and earlier backups left out, at `to` (deck-relative).
 * The system's `zip`, which streams and knows zip64, so a deck of any size fits; refused loudly when
 * it is missing, since nothing moves without a backup.
 */
export function backUp(deck: string, to: string): string {
	const full = join(deck, to);
	mkdirSync(dirname(full), { recursive: true });
	execFileSync("zip", ["-q", "-r", "-y", full, ".", "-x", "apps/*/node_modules/*", "-x", ".decks/backups/*", "-x", "*/node_modules/*"], { cwd: deck, stdio: ["ignore", "ignore", "pipe"], maxBuffer: 64 * 1024 * 1024 });
	return to;
}

/**
 * A copy of a deck file, as a clone where the disk can make one (APFS, btrfs): a copy that takes no
 * room until one of the two changes, so a film's renders copied into three canvases cost nothing.
 */
function copy(deck: string, from: string, to: string): void {
	const target = join(deck, to);
	mkdirSync(dirname(target), { recursive: true });
	copyFileSync(join(deck, from), target, constants.COPYFILE_FICLONE);
}

/** Every move, copy and rewrite, in the plan's order: files first, so a board's links land on something. */
function run(deck: string, plan: Plan): void {
	const linksFor = new Map<string, Array<{ from: string; to: string }>>();
	for (const step of plan.steps) if (step.kind === "links") linksFor.set(step.board, step.links);
	const removeAfter: string[] = [];
	for (const step of plan.steps) {
		if (step.kind === "file" || step.kind === "frame") {
			if (!existsSync(join(deck, step.to))) copy(deck, step.from, step.to);
		}
	}
	for (const step of plan.steps) {
		if (step.kind !== "move" && step.kind !== "copy") continue;
		const source = join(deck, step.from);
		const text = readFileSync(source);
		let out: Buffer | string = text;
		const links = linksFor.get(step.to);
		if (links?.length) out = rewriteLinks(text.toString("utf8"), links);
		const target = join(deck, step.to);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, out);
		if (step.kind === "move") removeAfter.push(source);
	}
	for (const source of removeAfter) rmSync(source, { force: true });
	// Frames copied into every canvas using them leave the deck's frames/.
	const framesCopied = new Set(plan.steps.filter((one) => one.kind === "frame" && one.from.startsWith("frames/")).map((one) => (one as { from: string }).from));
	for (const from of framesCopied) rmSync(join(deck, from), { force: true });
	// The drawings, each naming its boards from its own folder.
	for (const [name, map] of plan.byCanvas) rewriteDrawing(deck, name, map);
	for (const step of plan.steps) if (step.kind === "drawing" && !plan.byCanvas.has(step.canvas)) rewriteDrawing(deck, step.canvas, new Map());
}

/** A board's text with each changed link put in, in quotes, `url(…)` and markdown links alike. */
export function rewriteLinks(text: string, links: ReadonlyArray<{ from: string; to: string }>): string {
	const map = new Map(links.map((one) => [one.from, one.to]));
	return text.replace(LINK, (all, lead: string, link: string) => (map.has(link) ? `${lead}${map.get(link)}` : all));
}

/** A canvas's drawing, its boards named from its own folder and its fills pointing at their copies in `files/`. */
function rewriteDrawing(deck: string, name: string, map: ReadonlyMap<string, string>): void {
	const file = join(deck, "canvases", name, "canvas.pen");
	let doc: { children?: BoardNode[] };
	const text = readFileSync(file, "utf8");
	try {
		doc = JSON.parse(text) as { children?: BoardNode[] };
	} catch {
		return;
	}
	const folder = canvasFolder(name);
	for (const node of nodes(doc.children)) {
		const path = boardPathOf(node);
		if (path) {
			const now = map.get(path) ?? (insideBoards(path) ? `${folder}/boards/${insideBoards(path)}` : path);
			const reference = now.startsWith(`${folder}/`) ? now.slice(folder.length + 1) : now;
			node.metadata = { ...node.metadata, path: reference };
			node.url = urlFor(name, reference);
			continue;
		}
		rewriteFills(node, name, deck);
	}
	const next = `${JSON.stringify(doc, null, 2)}\n`;
	if (next !== text) writeFileSync(file, next);
}

/** An image fill pointing at a deck file, pointed at its copy in the canvas's `files/`. */
function rewriteFills(node: BoardNode, name: string, deck: string): void {
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) value.forEach(visit);
		else if (value && typeof value === "object") {
			const record = value as Record<string, unknown>;
			for (const [key, inner] of Object.entries(record)) {
				if (key === "children") continue;
				if (key === "url" && typeof inner === "string" && !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(inner)) {
					const target = posix.normalize(posix.join(`canvases/${name}`, inner));
					if (!target.startsWith("..") && !target.startsWith(`canvases/${name}/`) && existsSync(join(deck, `canvases/${name}/${filesPathFor(target)}`))) record[key] = filesPathFor(target);
				} else visit(inner);
			}
		}
	};
	for (const [key, value] of Object.entries(node)) if (key !== "children" && key !== "metadata") visit(value);
}

/**
 * What was kept per board path, under the new paths. A board copied onto several canvases is each of
 * them now, so each copy gets the record; a board moved leaves its old path behind.
 */
function rekey(deck: string, plan: Plan, dataDir: string | undefined, log: (line: string) => void): void {
	const moves = new Map<string, { to: string[]; gone: boolean }>();
	for (const step of plan.steps) {
		if (step.kind !== "move" && step.kind !== "copy") continue;
		const entry = moves.get(step.from) ?? { to: [], gone: false };
		entry.to.push(step.to);
		if (step.kind === "move") entry.gone = true;
		moves.set(step.from, entry);
	}
	if (!moves.size) return;
	const records = join(deck, ".decks");
	const remap = <T>(object: Record<string, T>): { next: Record<string, T>; count: number } => {
		const next: Record<string, T> = { ...object };
		let count = 0;
		for (const [from, { to, gone }] of moves) {
			if (!(from in object)) continue;
			for (const one of to) next[one] = object[from]!;
			if (gone) delete next[from];
			count += 1;
		}
		return { next, count };
	};
	for (const name of ["authors.json", "seen.json", "heights.json", join("revisions", "index.json")]) {
		const file = join(records, name);
		const object = readJson<Record<string, unknown>>(file);
		if (!object) continue;
		const { next, count } = remap(object);
		if (count) {
			writeFileSync(file, `${JSON.stringify(next, null, "\t")}\n`);
			plan.steps.push({ kind: "records", what: `.decks/${toPosix(name)}`, count });
		}
	}
	// Pictures: named by the hash of the board's path (`pictures/thumbs.ts`).
	const thumbs = join(records, "thumbs");
	if (existsSync(thumbs)) {
		const names = readdirSync(thumbs);
		const byPrefix = new Map<string, string[]>();
		for (const one of names) {
			const prefix = one.slice(0, 16);
			byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), one]);
		}
		let count = 0;
		for (const [from, { to, gone }] of moves) {
			const old = hashOf(from);
			const files = byPrefix.get(old);
			if (!files) continue;
			for (const file of files) {
				for (const one of to) copyFileSync(join(thumbs, file), join(thumbs, `${hashOf(one)}${file.slice(16)}`), constants.COPYFILE_FICLONE);
				if (gone) rmSync(join(thumbs, file), { force: true });
				count += 1;
			}
		}
		if (count) plan.steps.push({ kind: "records", what: ".decks/thumbs", count });
	}
	// Each agent's records: what it has in its context and in play, and where its boards were placed.
	const agents = join(records, "agents");
	if (existsSync(agents)) {
		let count = 0;
		for (const entry of readdirSync(agents, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const file = join(agents, entry.name, "meta.json");
			const meta = readJson<Record<string, unknown>>(file);
			if (!meta) continue;
			const stage = typeof meta.stage === "string" ? meta.stage : undefined;
			const pick = (path: string): string => {
				const on = stage ? plan.byCanvas.get(stage)?.get(path) : undefined;
				return on ?? moves.get(path)?.to[0] ?? path;
			};
			const next = { ...meta };
			if (Array.isArray(meta.context)) next.context = meta.context.map((one) => (typeof one === "string" ? pick(one) : one));
			if (Array.isArray(meta.inPlay)) next.inPlay = meta.inPlay.map((one) => (typeof one === "string" ? pick(one) : one));
			if (meta.positions && typeof meta.positions === "object") next.positions = Object.fromEntries(Object.entries(meta.positions as Record<string, unknown>).map(([path, at]) => [pick(path), at]));
			if (JSON.stringify(next) !== JSON.stringify(meta)) {
				writeFileSync(file, `${JSON.stringify(next, null, "\t")}\n`);
				count += 1;
			}
		}
		if (count) plan.steps.push({ kind: "records", what: ".decks/agents", count });
	}
	// The boards each canvas held when it was named (`canvas.json`).
	for (const [name, map] of plan.byCanvas) {
		const file = join(deck, "canvases", name, "canvas.json");
		const meta = readJson<{ boards?: unknown }>(file);
		if (!meta || !Array.isArray(meta.boards)) continue;
		const boards = meta.boards.map((one) => (typeof one === "string" ? (map.get(one) ?? one) : one));
		writeFileSync(file, `${JSON.stringify({ ...meta, boards }, null, "\t")}\n`);
	}
	// The Allow decisions: a board allowed to run its code still may, wherever it went.
	if (dataDir) {
		const file = join(dataDir, "board-eval.json");
		const trust = readJson<{ allowed?: unknown }>(file);
		if (trust && Array.isArray(trust.allowed)) {
			const allowed = new Set(trust.allowed.filter((one): one is string => typeof one === "string"));
			let count = 0;
			for (const [from, { to }] of moves) {
				if (!allowed.has(from)) continue;
				for (const one of to) allowed.add(one);
				count += 1;
			}
			if (count) {
				writeFileSync(file, `${JSON.stringify({ allowed: [...allowed].sort() }, null, "\t")}\n`);
				plan.steps.push({ kind: "records", what: "board-eval.json", count });
			}
		}
	}
	log(`re-keyed the records of ${moves.size} boards`);
}

const hashOf = (path: string) => createHash("sha1").update(path).digest("hex").slice(0, 16);

function record(deck: string, entry: Record<string, unknown>): void {
	const file = join(deck, ".decks", "migrations.json");
	const done = readJson<Record<string, unknown>>(file) ?? {};
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify({ ...done, [MIGRATION]: entry }, null, "\t")}\n`);
}
