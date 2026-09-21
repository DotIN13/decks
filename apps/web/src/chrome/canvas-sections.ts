import type { Canvas, Identity } from "@decks/protocol";

/**
 * What a list of canvases is cut by, and in what order.
 *
 * A canvas belongs to a workspace (`Canvas.workspace`), so every list of them — the panel's
 * Canvases tab and the dashboard's shelf — is the same cut: one heading per workspace, and
 * `No workspace` last for the ones nobody has filed. Pure and tested, for the reason the
 * agent list's grouping is: this is the whole of what the two lists *know*, and the two
 * surfaces must not disagree about which heading a canvas is under.
 *
 * ### The order
 *
 * **The room's workspace leads**, when there is a room and it is in one: on a stage the first
 * question is "what else is in this project", so the section holding the canvas on screen
 * goes first and says so (`here`). It is the one heading whose place depends on where you
 * stand; everything after it is A to Z, with `No workspace` last because it is not a project
 * and has no place in the alphabet of them — and a room in no workspace lifts nothing, since
 * `No workspace` at the top would read as a mistake. On the dashboard there is no room, so
 * the alphabet starts at the top.
 *
 * **Inside a heading, newest change first.** That is the order the shelf always had, and it
 * is what "the first canvas in a workspace" means everywhere: the one an agent's row opens,
 * and the one an agent moving into a project is put on (`session.setWorkspace`).
 */

export const NO_WORKSPACE = "No workspace";

export interface CanvasSection {
	/** `ws:` + the workspace, or the bare `ws:` for none — what `reconcile` joins on. */
	id: string;
	/** The workspace slug. Absent for the unfiled section. */
	workspace?: string;
	/** The heading, as written: the slug itself, or `No workspace`. */
	label: string;
	/** Whether the canvas on screen is in this section, which is what puts it first. */
	here: boolean;
	/** The canvases, newest change first. */
	rows: Canvas[];
}

export interface CanvasListInput {
	canvases: Canvas[];
	/** The canvas on screen, by id. Its section leads. Absent on the dashboard. */
	current?: string;
	/** What is typed in the search field. Matches the name and the workspace. */
	query?: string;
}

const fold = (query?: string) => (query ?? "").trim().toLowerCase();

export function canvasMatches(canvas: Pick<Canvas, "name" | "workspace">, needle: string): boolean {
	if (!needle) return true;
	return `${canvas.name}\n${canvas.workspace ?? ""}`.toLowerCase().includes(needle);
}

/** Newest change first — the order every list shows, and what "the first canvas" means. */
export const byChange = (a: Canvas, b: Canvas) => b.changedAt - a.changedAt || a.name.localeCompare(b.name);

export function canvasSections(input: CanvasListInput): CanvasSection[] {
	const needle = fold(input.query);
	const groups = new Map<string, Canvas[]>();
	for (const canvas of input.canvases) {
		if (!canvasMatches(canvas, needle)) continue;
		const name = canvas.workspace ?? "";
		const group = groups.get(name);
		if (group) group.push(canvas);
		else groups.set(name, [canvas]);
	}
	// A room in no workspace lifts nothing: `No workspace` at the top would read as a mistake.
	const roomKey = input.current ? input.canvases.find((canvas) => canvas.id === input.current)?.workspace : undefined;
	const section = (name: string): CanvasSection => ({
		id: `ws:${name}`,
		...(name ? { workspace: name } : {}),
		label: name || NO_WORKSPACE,
		here: name === roomKey,
		rows: [...(groups.get(name) ?? [])].sort(byChange),
	});
	const named = [...groups.keys()].filter((name) => name).sort((left, right) => left.localeCompare(right));
	const order = groups.has("") ? [...named, ""] : named;
	const first = roomKey !== undefined && groups.has(roomKey) ? [roomKey] : [];
	return [...first, ...order.filter((name) => name !== roomKey)].map(section);
}

/** The first canvas in a workspace (`undefined` for none): the newest change, which is what an agent's row opens. */
export function firstCanvasIn(canvases: readonly Canvas[], workspace: string | undefined): Canvas | undefined {
	return [...canvases].filter((canvas) => (canvas.workspace ?? "") === (workspace ?? "")).sort(byChange)[0];
}

/**
 * Every workspace in use, A to Z: what the agents say and what the canvases say, as one set.
 *
 * There is no registry of workspaces — a workspace exists by being named — so the list a
 * person picks from is the union of both writers, or a project with canvases and no agent
 * yet would be impossible to move an agent into.
 */
export function workspaceNames(canvases: readonly Canvas[], identities: Record<string, Identity>): string[] {
	const names = new Set<string>();
	for (const canvas of canvases) if (canvas.workspace) names.add(canvas.workspace);
	for (const identity of Object.values(identities)) if (identity.workspace) names.add(identity.workspace);
	return [...names].sort((left, right) => left.localeCompare(right));
}
