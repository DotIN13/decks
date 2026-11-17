import { ALLOW, PROTOCOL, SANDBOX, awaitHello, hearShared, peer, renewPass, sendStart, type Peer, type SharedCalls, type SharedToFrame, type SharedToPage } from "@decks/frame";
import { dismissMenus } from "@decks/ui";
import { createEffect, createSignal, on, onCleanup, onMount, untrack, type JSX } from "solid-js";
import type { CanvasPass } from "./outside/host.tsx";
import { CallRefused } from "./protocol.ts";

/** Light or dark, and how much of the window's foot the page's composer covers: what a frame shows can be scrolled clear of it. */
export interface ItemLook {
	dark: boolean;
	foot: number;
}

/** What every frame that shows one item of a canvas starts from, beside what its kind adds: the canvas, its pass, and the look. */
export interface ItemStart {
	protocol: number;
	kind: string;
	/** The canvas the item is on, whose pass this frame holds. */
	canvas: string;
	backend: { api: string; token: string; expires: number };
	/** Where the canvas's files are read, the pass in the address. */
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
/** The page's end of an item's frame, with the words its kind adds (`Own`). */
export type ItemPageEnd<Own = unknown> = Peer<PageToItem & Own, NoCalls, SharedToPage, SharedCalls>;
/** The frame's end. */
export type ItemEnd<Own = unknown> = Peer<SharedToPage, SharedCalls, PageToItem & Own, NoCalls>;

/** What the page gives the frame of one item, whatever its kind. */
export interface ItemFrameProps {
	/** The canvas the item is on, and the pass for it (the one its canvas's frame is given). */
	canvas: string;
	pass: (canvas: string) => Promise<CanvasPass>;
	dark: boolean;
	/** How much of the window's foot the page's composer covers, in pixels. */
	foot: number;
	/** A call that is the page's to make, with your login (the agents): as the canvas's frame is answered. */
	agent?: (call: { verb: string; args: unknown[]; card: string }) => unknown;
}

/**
 * One item of a canvas whole, in a frame of its own on the page: the frame every kind runs in
 * (`@decks/frame`), begun as the canvas's is (its hello, its canvas's pass kept current, its start
 * and the port), with the kind named in the start run inside it. The shared words are answered as
 * for any frame, and the look is said again when it changes. What the kind adds: what it starts
 * from (`start`), and what it is told later (`say`, run where it tracks what it reads).
 */
export function ItemFrame<Own>(props: ItemFrameProps & { kind: string; title: string; start: () => Record<string, unknown>; say?: (end: ItemPageEnd<Own>) => void }): JSX.Element {
	let gone = false;
	let stopWaiting = () => {};
	const [end, setEnd] = createSignal<ItemPageEnd<Own>>();
	const begin = (frame: HTMLIFrameElement) => {
		const canvas = props.canvas;
		stopWaiting = awaitHello(frame, {
			pass: () => props.pass(canvas),
			cancelled: () => gone,
			begin: (pass) => {
				const channel = new MessageChannel();
				const page = peer(channel.port1) as ItemPageEnd<Own>;
				hearShared(page as never, { dismiss: dismissMenus, agent: props.agent, refuse: (message) => new CallRefused(message, "refused") });
				setEnd(() => page);
				renewPass({ pass: () => props.pass(canvas), expires: pass.expires, cancelled: () => gone, renewed: (next) => (page as ItemPageEnd).emit("token", { token: next.token, files: { base: next.files, expires: next.expires } }) });
				const start: ItemStart = {
					protocol: PROTOCOL,
					kind: props.kind,
					canvas,
					backend: { api: pass.api, token: pass.token, expires: pass.expires },
					files: { base: pass.files, expires: pass.expires },
					...(pass.imports ? { imports: pass.imports } : {}),
					look: untrack(() => ({ dark: props.dark, foot: props.foot })),
				};
				sendStart(frame, { ...start, ...untrack(props.start) }, channel.port2);
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
