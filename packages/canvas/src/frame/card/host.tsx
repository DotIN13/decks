import { ALLOW, PROTOCOL, SANDBOX, awaitHello, hearShared, peer, renewPass, sendStart } from "@decks/frame";
import { dismissMenus } from "@decks/ui";
import { createEffect, createSignal, on, onCleanup, onMount, untrack, type JSX } from "solid-js";
import { CallRefused } from "../protocol.ts";
import type { CanvasPass } from "../outside/host.tsx";
import type { CardPageEnd, CardShown, CardStart } from "./protocol.ts";

/** What the page gives a card's frame. */
export interface CardFrameProps {
	/** The card to show, read again whenever it changes: its file's revision, its width. */
	card: CardShown;
	/** The canvas the card is on, and the pass for it (the one its canvas's frame is given). */
	canvas: string;
	pass: (canvas: string) => Promise<CanvasPass>;
	dark: boolean;
	/** How much of the window's foot the page's composer covers, in pixels. */
	foot: number;
	/** A call that is the page's to make, with your login (the agents): as the canvas's frame is answered. */
	agent?: (call: { verb: string; args: unknown[]; card: string }) => unknown;
}

/**
 * A card whole, in a frame of its own on the page: the frame every kind runs in (`@decks/frame`),
 * begun as the canvas's is (its hello, its canvas's pass kept current, its start and the port), with
 * the card kind inside it (`guest.tsx`). The shared words are answered as for any frame.
 */
export function CardFrame(props: CardFrameProps): JSX.Element {
	let gone = false;
	let stopWaiting = () => {};
	const [end, setEnd] = createSignal<CardPageEnd>();
	const begin = (frame: HTMLIFrameElement) => {
		const canvas = props.canvas;
		stopWaiting = awaitHello(frame, {
			pass: () => props.pass(canvas),
			cancelled: () => gone,
			begin: (pass) => {
				const channel = new MessageChannel();
				const page = peer(channel.port1) as CardPageEnd;
				hearShared(page as never, { dismiss: dismissMenus, agent: props.agent, refuse: (message) => new CallRefused(message, "refused") });
				setEnd(page);
				renewPass({ pass: () => props.pass(canvas), expires: pass.expires, cancelled: () => gone, renewed: (next) => page.emit("token", { token: next.token, files: { base: next.files, expires: next.expires } }) });
				const start: CardStart = {
					protocol: PROTOCOL,
					kind: "card",
					canvas,
					card: untrack(() => ({ ...props.card })),
					backend: { api: pass.api, token: pass.token, expires: pass.expires },
					files: { base: pass.files, expires: pass.expires },
					...(pass.imports ? { imports: pass.imports } : {}),
					look: untrack(() => ({ dark: props.dark, foot: props.foot })),
				};
				sendStart(frame, start, channel.port2);
			},
		});
	};
	// The look and the card's file, said when they change after the start.
	createEffect(on(() => [props.dark, props.foot] as const, ([dark, foot]) => end()?.emit("look", { dark, foot }), { defer: true }));
	createEffect(on(() => [props.card.rev, props.card.w] as const, ([rev, w]) => end()?.emit("card", { rev, w }), { defer: true }));
	// A press on the page puts the frame's menus away, as a press in the frame puts the page's.
	onMount(() => {
		const away = () => end()?.emit("away", {});
		addEventListener("pointerdown", away, true);
		onCleanup(() => removeEventListener("pointerdown", away, true));
	});
	onCleanup(() => {
		gone = true;
		stopWaiting();
		end()?.close();
	});
	return <iframe ref={begin} class="card-frame" title={props.card.title} sandbox={SANDBOX} allow={ALLOW} src="/canvas-frame.html" style={{ position: "absolute", inset: "0", width: "100%", height: "100%", border: "0", display: "block" }} />;
}
