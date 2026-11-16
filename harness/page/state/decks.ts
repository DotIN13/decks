import { call } from "./line.ts";
import { notice } from "./notices.ts";
import { rewatch } from "./pens.ts";
import { canvasOf } from "./canvases.ts";

// The person's calls that change the deck, with a refusal said as a notice.
// The canvas on screen and the agent being talked to are named by the shell.

/** Who the page acts for: the canvas on screen and the conversation open. Set once, by the shell. */
const person = { canvas: (() => undefined) as () => string | undefined, agent: (() => undefined) as () => string | undefined };

export function setPersonCanvas(canvas: () => string | undefined, agent: () => string | undefined): void {
	person.canvas = canvas;
	person.agent = agent;
}

export function canvasOnScreen(): string | undefined {
	return person.canvas();
}

/** Make a call for the person; a refusal is said as a notice and answers undefined. */
export async function act<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T | undefined> {
	const answer = await call<T>(name, args);
	if (answer.ok) return answer.value;
	notice("warn", answer.error);
	return undefined;
}

/** The editor in the frame, when one is up: the person's edits go through it so they undo there. */
const frame = { editor: undefined as { agentId: () => string | undefined; edit(ops: unknown[]): void } | undefined };

export function setDrawingEditor(editor: typeof frame.editor): void {
	frame.editor = editor;
}

/** Change the drawing of an agent's canvas: through the frame's editor when it shows it, else by item.batch. */
export async function editDrawing(agentId: string, ops: unknown[]): Promise<void> {
	if (frame.editor && frame.editor.agentId() === agentId) return frame.editor.edit(ops);
	const canvas = canvasOf(agentId)?.name;
	const done = await act("item.batch", { ops: (ops as PenOp[]).map(itemOp), ...(canvas ? { canvas } : {}) });
	if (done === undefined) rewatch(canvas);
}

type PenOp = { op: string; node?: Record<string, unknown>; box?: { x1?: number; y1?: number; x2?: number; y2?: number }; id?: string; [key: string]: unknown };

/** pen.dev's own op form ({ op, node, box }) as an item op: its corner as at, its far corner as the node's size. */
export function itemOp(op: PenOp): Record<string, unknown> {
	if (op.op !== "insert" || !op.node) return op;
	const { node, box, op: _op, ...rest } = op;
	const at = box && box.x1 !== undefined && box.y1 !== undefined ? { at: { x: box.x1, y: box.y1 } } : {};
	const w = box?.x1 !== undefined && box.x2 !== undefined ? { width: box.x2 - box.x1 } : {};
	const h = box?.y1 !== undefined && box.y2 !== undefined ? { height: box.y2 - box.y1 } : {};
	return { op: "insert", item: { ...node, ...w, ...h }, ...at, ...rest };
}
