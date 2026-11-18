import { PROTOCOL, type Hello, type StartMessage } from "./hello.ts";
import { endLife } from "./life.ts";
import { offerKept } from "./kept.ts";

/** What a kind gives the guest: how to run on a start, and what to clear when it is begun anew. */
export interface Guest<Start> {
	/** Run what the frame shows, from `start`, on its end of the port; answers how to stop it. */
	run(start: Start, port: MessagePort): Promise<(() => void) | undefined>;
	/** What was running has been stopped and its life ended (`life.ts`): clear what it left, before hello is said again. */
	cleared?(): void;
}

/**
 * The frame's side of the first words (`hello.ts`): say hello to the parent, take its start and the
 * port, and run. Whatever the kind, a frame is begun the same way.
 *
 * And begun anew in place: at the page's `reset` what is running is stopped, its life ended (its
 * listeners, its line), and hello is said again for the next thing, the frame keeping what it loaded
 * (its code, a compiled module). Once what is running now has started, so nothing of it is left half
 * made. Only from the parent, which decides when.
 */
export function bootGuest<Start>(guest: Guest<Start>): void {
	const parent = window.parent;
	if (parent === window) throw new Error("A frame runs inside the app's page.");
	/** What is running now, as the way to stop it once it has started. */
	let running: Promise<(() => void) | undefined> = Promise.resolve(undefined);
	const onStart = (event: MessageEvent<StartMessage<Start>>) => {
		// Only the parent's answer, with its port: nothing else is read, then or later.
		if (event.source !== parent || event.data?.t !== "start" || !event.ports[0]) return;
		removeEventListener("message", onStart);
		running = guest.run(event.data.start, event.ports[0]).catch((error: unknown) => {
			console.error(error);
			return undefined;
		});
	};
	addEventListener("message", (event) => {
		if (event.source !== parent || (event.data as { t?: string } | null)?.t !== "reset") return;
		removeEventListener("message", onStart);
		running = running.then((stop) => {
			stop?.();
			endLife();
			guest.cleared?.();
			addEventListener("message", onStart);
			parent.postMessage({ t: "hello", protocol: PROTOCOL } satisfies Hello, "*");
			return undefined;
		});
	});
	addEventListener("message", onStart);
	// The line to what the page keeps (`kept.ts`), offered before hello: what is fetched as this frame starts can come down it.
	offerKept(parent);
	parent.postMessage({ t: "hello", protocol: PROTOCOL } satisfies Hello, "*");
}
