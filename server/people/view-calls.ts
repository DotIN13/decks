import { Refused, calls, events, type Handled, type Infer, type shapes } from "../../protocol/index.ts";
import { handleAll, type Context } from "../kernel/types.ts";
import { canvasName, followHome } from "./agent-calls.ts";
import type { Holder, People } from "./state.ts";

// What screens show. An agent's request reaches only the screens that follow
// it; the person's, only their own screens; a card's or app's, the screens
// showing its canvas. A screen says whom it follows with view.move.

type View = Infer<typeof shapes.View>;
const ORIGIN = { x: 0, y: 0, zoom: 1 };

export function viewCalls(holder: Holder): Handled<Context>[] {
	const p = () => holder.get();
	return handleAll(calls.view, {
		get: (ctx, { canvas }) => look(p(), ctx, here(p(), ctx, canvas)),
		move: (ctx, args) => move(p(), ctx, args),
		focus: async (ctx, { target, highlight, animate, canvas }) => {
			const name = here(p(), ctx, canvas ?? canvasOfTarget(target));
			const wanted = Array.isArray(target) ? target : [target];
			if (!wanted.length) throw new Refused("invalid", "focus names an item's id or a card's path, or a list of them.", "item.list");
			const items = ctx.canvas(name).read();
			for (const one of wanted) {
				if (!items.some((i) => i.id === one || i.card === one)) throw new Refused("not_found", `Nothing called ${one} is on the canvas ${name}.`, "item.list");
			}
			await goHome(p(), ctx, name);
			return request(p(), ctx, name, "view.focus", { target, canvas: name, ...(highlight ? { highlight } : {}), ...(animate ? { animate } : {}) });
		},
		goto: async (ctx, { canvas }) => {
			const name = canvasName(ctx, canvas);
			if (!(await goHome(p(), ctx, name))) return request(p(), ctx, name, "view.goto", { canvas: name });
			return answer(p(), ctx, name, recipients(p(), ctx, name));
		},
		cursor: (ctx, { card, at }) => {
			const name = here(p(), ctx, canvasOfTarget(card));
			const color = ctx.caller.kind === "agent" ? p().roster.byIdOrUndefined(ctx.caller.id)?.color : undefined;
			const screens = p().screens.showing(name).map((s) => s.client);
			if (screens.length) p().tell(ctx, events.viewRequested, { ids: [card], canvas: name, call: "view.cursor", args: { card, at, label: ctx.caller.name, ...(color ? { color } : {}) } }, screens);
			return { ...look(p(), ctx, name), moved: screens.length > 0 };
		},
		screenshot: async (ctx, { card, canvas }) => {
			const name = here(p(), ctx, canvas ?? canvasOfTarget(card));
			const screen = p().screens.showing(name).sort((a, b) => b.at - a.at)[0];
			if (!screen) throw new Refused("unavailable", `No screen is showing the canvas ${name}, so none can draw ${card}.`, "canvas.screenshot");
			const { id, answer } = p().answers.ask(screen.client, `a picture of ${card}`);
			p().tell(ctx, events.viewRequested, { ids: [card], canvas: name, call: "view.screenshot", args: { card }, id }, [screen.client]);
			return (await answer) as Infer<typeof calls.view.screenshot.answer>;
		},
		answer: (ctx, { id, value, error }) => ({ ok: p().answers.answer(id, ctx.client?.id, { ...(value !== undefined ? { value } : {}), ...(error !== undefined ? { error } : {}) }) }),
		reload: (ctx, { card, canvas }) => {
			const name = here(p(), ctx, canvas ?? (card ? canvasOfTarget(card) : undefined));
			const screens = p().screens.showing(name).map((s) => s.client);
			if (screens.length) p().tell(ctx, events.viewRequested, { ids: card ? [card] : [], canvas: name, call: "view.reload", args: { ...(card ? { card } : {}), canvas: name } }, screens);
			return screens.length;
		},
	});
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

/** The canvas a call means: the one named, else the caller's here, else its home. */
function here(people: People, ctx: Context, asked: string | undefined): string {
	if (asked) return canvasName(ctx, asked);
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

/** The person's page reports its screen; anyone else asks the screens to move. */
function move(people: People, ctx: Context, args: Infer<typeof calls.view.move.input>): View {
	const name = here(people, ctx, args.canvas);
	const camera = { x: args.x, y: args.y, zoom: args.zoom };
	const client = people.meet(ctx);
	if (ctx.caller.kind === "person" && client) {
		people.screens.report(client, ctx.caller.id, { canvas: name, ...(args.agent !== undefined ? { follows: people.roster.find(args.agent).id } : {}) });
		const follows = people.screens.ofPerson(ctx.caller.id).find((s) => s.client === client)?.follows;
		people.screens.record(ctx.caller.id, name, args.device, camera);
		if (follows) people.screens.record(follows, name, args.device, camera);
		return { canvas: name, camera, moved: true };
	}
	people.screens.record(ctx.caller.id, name, args.device, camera);
	return request(people, ctx, name, "view.move", { ...camera, canvas: name, ...(args.animate ? { animate: true } : {}) });
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
