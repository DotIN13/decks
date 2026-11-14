import { Refused, type Caller } from "../../protocol/index.ts";
import { Callers } from "./callers.ts";
import { EventBus } from "./events.ts";
import { HistoryDeck } from "./history.ts";
import { ownFeature } from "./own-calls.ts";
import { Router, routesOf, type MakeContext } from "./router.ts";
import type { Stores } from "./store.ts";
import type { CanvasDoc, CanvasSource, Context, Deck, Feature, Kernel, Stop } from "./types.ts";

// Builds the kernel from a deck, a store per feature and the features: the
// deck wrapped in history, the callers, the event stream, the canvas source,
// the router, and every feature started in order before the first call.

export type KernelOptions = { deck: Deck & { startAt?(rev: number): void }; stores: Stores; features: Feature[]; clock?: () => number; checkAnswers?: boolean };
export type Built = { kernel: Kernel; router: Router; events: EventBus; callers: Callers; history: HistoryDeck; features: Feature[]; stop(): Promise<void> };

function canvasSource(features: Feature[], kernel: Kernel): CanvasSource | undefined {
	const givers = features.filter((one) => one.canvases);
	if (givers.length > 1) throw new Error(`Only one feature may keep canvases; ${givers.map((one) => one.name).join(" and ")} both do.`);
	return givers[0]?.canvases?.(kernel);
}

export async function buildKernel(options: KernelOptions): Promise<Built> {
	const clock = options.clock ?? Date.now;
	const history = new HistoryDeck(options.deck, options.stores("history"));
	await history.load();
	options.deck.startAt?.(history.lastRev());
	const callers = new Callers(options.stores("kernel"), clock);
	await callers.load();
	const events = new EventBus();
	const features = [ownFeature(callers, clock), ...options.features];
	let source: CanvasSource | undefined;
	const nameOf = (name: string): string => {
		if (!source) throw new Refused("unavailable", "No feature on this server keeps canvases yet.");
		return source.name(name);
	};
	const canvas = (name: string): CanvasDoc => source!.doc(nameOf(name));
	const kinds = features.flatMap((one) => one.items ?? []);
	const kernel: Kernel = { deck: history, events, canvas, callers, store: options.stores, kinds };
	source = canvasSource(features, kernel);
	const makeContext: MakeContext = (feature, caller, notes, client) => contextFor({ feature, caller, notes, kernel, canvas, nameOf, ...(client ? { client } : {}) });
	const router = new Router(routesOf(features), makeContext, options.checkAnswers ?? false);
	const stops: Stop[] = [];
	for (const one of features) {
		const stop = await one.start?.(kernel);
		if (stop) stops.push(stop);
	}
	const stop = async () => {
		for (const one of stops.reverse()) one();
		await callers.flush();
	};
	return { kernel, router, events, callers, history, features, stop };
}

type ContextParts = { feature: string; caller: Caller; notes: string[]; kernel: Kernel; canvas: (name: string) => CanvasDoc; nameOf: (name: string) => string; client?: Context["client"] };

function contextFor(parts: ContextParts): Context {
	const { caller, kernel } = parts;
	return {
		caller,
		deck: kernel.deck,
		events: kernel.events,
		store: kernel.store(parts.feature),
		note: (text) => void parts.notes.push(text),
		canvas: (name) => parts.canvas(asked(caller, name)),
		canvasName: (name) => parts.nameOf(asked(caller, name)),
		...(parts.client ? { client: parts.client } : {}),
	};
}

function asked(caller: Caller, name: string | undefined): string {
	const named = name ?? caller.canvas;
	if (!named) throw new Refused("invalid", "Name a canvas; this caller has no here.", "canvas.list");
	return named;
}
