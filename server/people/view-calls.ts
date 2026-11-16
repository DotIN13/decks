import { Refused, calls, events, type Handled, type Infer, type shapes } from "../../protocol/index.ts";
import { handleAll, type Context } from "../kernel/types.ts";
import type { AgentRecord } from "./records.ts";
import type { Holder, People } from "./state.ts";

// What screens show. An agent's request reaches only the screens that follow
// it; the person's, only their own screens; a card's or app's, the screens
// showing its canvas; cursors, pictures and reloads, every line on the canvas.

/** The calls handled here, named, so a call added to the noun for another feature stays unhandled. */
const VIEW_CALLS = (({ get, move, focus, goto, cursor, screenshot, answer, update, reload }: typeof calls.view) => ({ get, move, focus, goto, cursor, screenshot, answer, update, reload }))(calls.view);

type View = Infer<typeof shapes.View>;
const ORIGIN = { x: 0, y: 0, zoom: 1 };

export function viewCalls(holder: Holder): Handled<Context>[] {
	const p = () => holder.get();
	return handleAll(VIEW_CALLS, {
		get: (ctx, { canvas }) => look(p(), ctx, here(p(), ctx, canvas)),
		move: (ctx, args) => move(p(), ctx, args),
		focus: (ctx, args) => focus(p(), ctx, args),
		goto: (ctx, { canvas }) => goto(p(), ctx, canvas),
		cursor: (ctx, args) => cursor(p(), ctx, args),
		screenshot: (ctx, args) => screenshot(p(), ctx, args),
		answer: (_ctx, { id, value, error }) => ({ ok: p().answers.answer(id, { ...(value !== undefined ? { value } : {}), ...(error !== undefined ? { error } : {}) }) }),
		update: (ctx, args) => say(p(), ctx, args),
		reload: (ctx, args) => reload(p(), ctx, args),
	});
}

// Which canvas a call means, and what its screen shows
/** The canvas a call means: the one named, else the caller's here, else its home. */
function here(people: People, ctx: Context, asked: string | undefined): string {
	if (asked) return ctx.canvasName(asked);
	const home = ctx.caller.canvas ?? (ctx.caller.kind === "agent" ? people.roster.byIdOrUndefined(ctx.caller.id)?.canvas : undefined);
	if (!home) throw new Refused("invalid", "Name a canvas: this caller has no canvas of its own.", "canvas.list");
	return home;
}

/** The canvas a card's path is in, canvases/<name>/... */
function canvasOfTarget(target: string | string[]): string | undefined {
	const first = (Array.isArray(target) ? target : [target]).find((t) => t.startsWith("canvases/"));
	return first?.split("/")[1];
}

function look(people: People, ctx: Context, canvas: string): View {
	const camera = people.screens.camera(ctx.caller.id, canvas) ?? ORIGIN;
	const screen = people.screens.sizeOn(canvas, people.screens.ofPerson(ctx.caller.id));
	return { canvas, camera, ...(screen ? { screen } : {}) };
}

// Moving screens: reports, homes, and requests to the screens a caller may reach
/** The person's page reports its screen; anyone else asks the screens to move. */
function move(people: People, ctx: Context, args: Infer<typeof calls.view.move.input>): View {
	const name = here(people, ctx, args.canvas);
	const camera = { x: args.x, y: args.y, zoom: args.zoom };
	const client = people.meet(ctx);
	if (ctx.caller.kind === "person" && client) {
		const said = { canvas: name, ...(args.device === "frame" ? { frame: true } : {}), ...(args.agent !== undefined ? { follows: people.roster.find(args.agent).id } : {}) };
		people.screens.report(client, ctx.caller.id, said);
		const follows = people.screens.ofPerson(ctx.caller.id).find((s) => s.client === client)?.follows;
		people.screens.record(ctx.caller.id, name, args.device, camera);
		if (follows) people.screens.record(follows, name, args.device, camera);
		return { canvas: name, camera, moved: true };
	}
	people.screens.record(ctx.caller.id, name, args.device, camera);
	return request(people, ctx, name, "view.move", { ...camera, canvas: name, ...(args.animate ? { animate: true } : {}) });
}

/** Fly to items or a card, on its canvas: one not the agent's home is gone to first. */
async function focus(people: People, ctx: Context, { target, highlight, animate, canvas }: Infer<typeof calls.view.focus.input>): Promise<View> {
	const name = here(people, ctx, canvas ?? canvasOfTarget(target));
	const wanted = Array.isArray(target) ? target : [target];
	if (!wanted.length) throw new Refused("invalid", "focus names an item's id or a card's path, or a list of them.", "item.list");
	const items = ctx.canvas(name).read();
	for (const one of wanted) {
		if (!items.some((i) => i.id === one || i.card === one)) throw new Refused("not_found", `Nothing called ${one} is on the canvas ${name}.`, "item.list");
	}
	await goHome(people, ctx, name);
	return request(people, ctx, name, "view.focus", { target, canvas: name, ...(highlight ? { highlight } : {}), ...(animate ? { animate } : {}) });
}

/** The agent acted for goes to the canvas; with none, the caller's own screens are asked to. */
async function goto(people: People, ctx: Context, canvas: string): Promise<View> {
	const name = ctx.canvasName(canvas);
	if (!(await goHome(people, ctx, name))) return request(people, ctx, name, "view.goto", { canvas: name });
	return answer(people, ctx, name, recipients(people, ctx, name));
}

/** The agent acted for moves its home to the canvas, with the screens following it; false for no agent. */
async function goHome(people: People, ctx: Context, canvas: string): Promise<boolean> {
	const follows = ctx.caller.kind === "person" ? people.screens.newestOf(ctx.caller.id)?.follows : undefined;
	if (ctx.caller.kind !== "agent" && !follows) return false;
	const actor = people.actor(ctx);
	if (actor.canvas === canvas) return true;
	const { record } = await people.roster.update(actor.id, { canvas });
	people.tell(ctx, events.agentChanged, { ids: [record.id] });
	followHome(people, ctx, record);
	return true;
}

/** The screens following an agent go to its new home. */
export function followHome(people: People, ctx: Context, record: AgentRecord): void {
	const screens = people.screens.following(record.id).map((s) => s.client);
	if (screens.length && record.canvas) people.tell(ctx, events.viewRequested, { ids: [record.id], canvas: record.canvas, call: "view.goto", args: { canvas: record.canvas } }, screens);
}

/** Which screens a caller's view call reaches. */
function recipients(people: People, ctx: Context, canvas: string): string[] {
	const own = ctx.client?.id;
	if (ctx.caller.kind === "agent") return people.screens.following(ctx.caller.id).map((s) => s.client);
	if (ctx.caller.kind === "person") return people.screens.ofPerson(ctx.caller.id).map((s) => s.client).filter((c) => c !== own);
	return people.screens.showing(canvas).map((s) => s.client);
}

function request(people: People, ctx: Context, canvas: string, call: string, args: Record<string, unknown>): View {
	const screens = recipients(people, ctx, canvas);
	if (screens.length) people.tell(ctx, events.viewRequested, { ids: [], canvas, call, args }, screens);
	return answer(people, ctx, canvas, screens);
}

function answer(people: People, ctx: Context, canvas: string, screens: string[]): View {
	const view = look(people, ctx, canvas);
	if (screens.length) return { ...view, moved: true };
	const waiting = ctx.caller.kind === "agent" ? "no screen follows this agent; the person sees it when they open its conversation" : "no screen is showing this canvas";
	ctx.note(`The view did not move: ${waiting}.`);
	return { ...view, moved: false, waiting };
}

// The canvas's lines: cursors, pictures and reloads reach every line on it, frames included
/** A labelled dot on a card, drawn by the canvas's lines. */
function cursor(people: People, ctx: Context, { card, at }: Infer<typeof calls.view.cursor.input>): View {
	const name = here(people, ctx, canvasOfTarget(card));
	const color = ctx.caller.kind === "agent" ? people.roster.byIdOrUndefined(ctx.caller.id)?.color : undefined;
	const screens = people.screens.showing(name).map((s) => s.client);
	const lines = people.screens.drawing(name).map((s) => s.client);
	if (lines.length) people.tell(ctx, events.viewRequested, { ids: [card], canvas: name, call: "view.cursor", args: { card, at, label: ctx.caller.name, ...(color ? { color } : {}) } }, lines);
	return { ...look(people, ctx, name), moved: screens.length > 0 };
}

/** A card as a line on its canvas draws it now: the first answer to view.answer, or unavailable. */
async function screenshot(people: People, ctx: Context, { card, canvas }: Infer<typeof calls.view.screenshot.input>): Promise<Infer<typeof calls.view.screenshot.answer>> {
	const name = here(people, ctx, canvas ?? canvasOfTarget(card));
	const screen = people.screens.drawing(name)[0];
	if (!screen) throw new Refused("unavailable", `No screen is showing the canvas ${name}, so none can draw ${card}.`, "canvas.screenshot");
	const { id, answer } = people.answers.ask(screen.client, `a picture of ${card}`);
	people.tell(ctx, events.viewRequested, { ids: [card], canvas: name, call: "view.screenshot", args: { card }, id });
	return (await answer) as Infer<typeof calls.view.screenshot.answer>;
}

/** Reload a card on every line showing its canvas; answers how many screens were asked. */
function reload(people: People, ctx: Context, { card, canvas }: Infer<typeof calls.view.reload.input>): number {
	const name = here(people, ctx, canvas ?? (card ? canvasOfTarget(card) : undefined));
	const screens = people.screens.showing(name).map((s) => s.client);
	const lines = people.screens.drawing(name).map((s) => s.client);
	if (lines.length) people.tell(ctx, events.viewRequested, { ids: card ? [card] : [], canvas: name, call: "view.reload", args: { ...(card ? { card } : {}), canvas: name } }, lines);
	return screens.length;
}

// Presence: where a line points and what it selected
/** A line says where it points and what it selected; the canvas's other lines hear it, in its colour.
 * A person's line goes unnamed: to them it is another window of their own. */
function say(people: People, ctx: Context, args: Infer<typeof calls.view.update.input>): View {
	const name = here(people, ctx, args.canvas);
	const client = people.meet(ctx);
	const line = client ?? ctx.caller.id;
	if (client && !people.screens.has(client)) people.screens.report(client, ctx.caller.id, { canvas: name, frame: true });
	const color = people.presence.colorOf(line, name);
	const { canvas: _c, ...said } = args;
	const others = people.screens.drawing(name).map((s) => s.client).filter((c) => c !== client);
	const kind = ctx.caller.kind === "agent" ? "agent" : "person";
	if (others.length) people.tell(ctx, events.viewChanged, { canvas: name, ids: args.selection ?? [], ...said, ...(kind === "agent" ? { name: ctx.caller.name } : {}), kind, color }, others);
	return look(people, ctx, name);
}
