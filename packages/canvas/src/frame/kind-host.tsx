import { ALLOW, PROTOCOL, SANDBOX, awaitHello, hearShared, peer, renewPass, sendStart, type Peer, type SharedCalls, type SharedToFrame, type SharedToPage } from "@decks/frame";
import { dismissMenus } from "@decks/ui";
import { createEffect, createSignal, on, onCleanup, onMount, untrack, type JSX } from "solid-js";
import type { CanvasPass } from "./outside/host.tsx";
import { CallRefused } from "./protocol.ts";
import { keepForFrames } from "./outside/kept.ts";

/** Light or dark, and how much of the window's foot the page's composer covers: what a frame shows can be scrolled clear of it. */
export interface ItemLook {
	dark: boolean;
	foot: number;
}

/** What every frame that shows one item starts from, beside what its kind adds: the pass it holds, and the look. */
export interface ItemStart {
	protocol: number;
	kind: string;
	/** The harness, and the pass this frame holds for it: a canvas's for a card, a document's own for a document. */
	backend: { api: string; token: string; expires: number };
	/** Where its files are read, the pass in the address; none (`""`) on a pass that reads no files. */
	files: { base: string; expires: number };
	/** The deck's import map, as the canvas's frame is given it. */
	imports?: Record<string, string>;
	look: ItemLook;
}

/** Page to such a frame: the shared words, and the look when it changes. */
export interface PageToItem extends SharedToFrame {
	look: ItemLook;
}

type NoCalls = Record<never, { data: unknown; value: unknown }>;
/** The page's end of an item's frame, with the words its kind adds: what the page says to it (`Own`), and what it says to the page (`Says`). */
export type ItemPageEnd<Own = unknown, Says = unknown> = Peer<PageToItem & Own, NoCalls, SharedToPage & Says, SharedCalls>;
/** The frame's end. */
export type ItemEnd<Own = unknown, Says = unknown> = Peer<SharedToPage & Says, SharedCalls, PageToItem & Own, NoCalls>;

/** The pass a frame of one item holds, as the page fetched it: a canvas's whole, or a document's, which reads no files. */
export type ItemPass = Pick<CanvasPass, "api" | "token" | "expires"> & Partial<Pick<CanvasPass, "files" | "imports">>;

/** What the page gives the frame of one item, whatever its kind. */
export interface ItemLookProps {
	dark: boolean;
	/** How much of the window's foot the page's composer covers, in pixels. */
	foot: number;
	/** A call that is the page's to make, with your login (the agents): as the canvas's frame is answered. */
	agent?: (call: { verb: string; args: unknown[]; card: string }) => unknown;
}

/**
 * One item whole, in a frame of its own on the page: the frame every kind runs in
 * (`@decks/frame`), begun as the canvas's is (its hello, its pass kept current, its start
 * and the port), with the kind named in the start run inside it. The shared words are answered as
 * for any frame, and the look is said again when it changes. What the kind adds: what it starts
 * from (`start`, given the pass held), what the page hears from it (`hear`, once, as the port opens),
 * and what it is told later (`say`, run where it tracks what it reads).
 */
export function ItemFrame<Own = unknown, Says = unknown, Pass extends ItemPass = ItemPass>(
	props: ItemLookProps & {
		kind: string;
		title: string;
		/** The pass the frame holds, fetched now and again at half its life. */
		pass: () => Promise<Pass>;
		start: (held: Pass) => Record<string, unknown>;
		hear?: (end: ItemPageEnd<Own, Says>) => void;
		say?: (end: ItemPageEnd<Own, Says>) => void;
	},
): JSX.Element {
	let gone = false;
	let stopWaiting = () => {};
	// What never changes is fetched once by this page for all its frames (`outside/kept.ts`).
	keepForFrames();
	const [end, setEnd] = createSignal<ItemPageEnd<Own, Says>>();
	const begin = (frame: HTMLIFrameElement) => {
		const pass = untrack(() => props.pass);
		stopWaiting = awaitHello(frame, {
			pass,
			cancelled: () => gone,
			begin: (held) => {
				const channel = new MessageChannel();
				const page = peer(channel.port1) as ItemPageEnd<Own, Says>;
				hearShared(page as never, { dismiss: dismissMenus, agent: props.agent, refuse: (message) => new CallRefused(message, "refused") });
				props.hear?.(page);
				setEnd(() => page);
				// A pass that never runs out (an app's, good while the token behind it works) is not asked for again.
				if (Number.isFinite(held.expires)) renewPass({ pass, expires: held.expires, cancelled: () => gone, renewed: (next) => (page as ItemPageEnd).emit("token", { token: next.token, ...(next.files ? { files: { base: next.files, expires: next.expires } } : {}) }) });
				const start: ItemStart = {
					protocol: PROTOCOL,
					kind: props.kind,
					backend: { api: held.api, token: held.token, expires: held.expires },
					files: { base: held.files ?? "", expires: held.expires },
					...(held.imports ? { imports: held.imports } : {}),
					look: untrack(() => ({ dark: props.dark, foot: props.foot })),
				};
				sendStart(frame, { ...start, ...untrack(() => props.start(held)) }, channel.port2);
			},
		});
	};
	createEffect(on(() => [props.dark, props.foot] as const, ([dark, foot]) => (end() as ItemPageEnd | undefined)?.emit("look", { dark, foot }), { defer: true }));
	// What the kind says after the start, when what it reads changes.
	createEffect(() => {
		const page = end();
		if (page) props.say?.(page);
	});
	// A press on the page puts the frame's menus away, as a press in the frame puts the page's.
	onMount(() => {
		const away = () => (end() as ItemPageEnd | undefined)?.emit("away", {});
		addEventListener("pointerdown", away, true);
		onCleanup(() => removeEventListener("pointerdown", away, true));
	});
	onCleanup(() => {
		gone = true;
		stopWaiting();
		end()?.close();
	});
	return <iframe ref={begin} class={`${props.kind}-frame`} title={props.title} sandbox={SANDBOX} allow={ALLOW} src="/canvas-frame.html" style={{ position: "absolute", inset: "0", width: "100%", height: "100%", border: "0", display: "block" }} />;
}
