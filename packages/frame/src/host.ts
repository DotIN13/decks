import type { StartMessage } from "./hello.ts";

/** How long after a failed renewal a pass is asked for again. */
const RETRY_MS = 30_000;

/**
 * The page's side of the first words (`hello.ts`): the frame's hello is listened for at once (a frame
 * begun anew in place says it again soon after its `reset`), and its pass is asked for beside it;
 * once both are here, `begin` is called with the pass, to hand the frame everything it starts with
 * (`sendStart`). Answers how to stop waiting, for a frame left before it started.
 */
export function awaitHello<Pass>(frame: HTMLIFrameElement, d: { pass(): Promise<Pass>; cancelled(): boolean; begin(pass: Pass): void }): () => void {
	let said = false;
	let pass: Pass | undefined;
	const begin = (got: Pass) => {
		if (!d.cancelled()) d.begin(got);
	};
	const onHello = (event: MessageEvent) => {
		if (event.source !== frame.contentWindow || event.data?.t !== "hello") return;
		removeEventListener("message", onHello);
		said = true;
		if (pass) begin(pass);
	};
	addEventListener("message", onHello);
	void d.pass().then(
		(got) => {
			if (d.cancelled()) return;
			pass = got;
			if (said) begin(got);
		},
		(error: unknown) => console.error(error),
	);
	return () => removeEventListener("message", onHello);
}

/**
 * The page's answer to a frame's hello: what it starts from, and its end of the port. To this frame's
 * window alone: a sandboxed page has no origin to name, so "*", and the port beside it. A plain copy:
 * a host's state is often a store, whose proxies the structured clone refuses.
 */
export function sendStart<Start>(frame: HTMLIFrameElement, start: Start, port: MessagePort): void {
	frame.contentWindow?.postMessage({ t: "start", start: JSON.parse(JSON.stringify(start)) as Start } satisfies StartMessage<Start>, "*", [port]);
}

/**
 * A frame's pass, asked for again unseen at half its life, for as long as the frame is there; and at
 * once when the tab is shown again past that, since a hidden tab's timers are held back. One that
 * fails is asked for again in thirty seconds. `renewed` hands the frame the new one; what it already
 * loaded stays loaded.
 */
export function renewPass<Pass extends { expires: number }>(d: { pass(): Promise<Pass>; expires: number; cancelled(): boolean; renewed(next: Pass): void }): void {
	let expires = d.expires;
	let since = Date.now();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let asking = false;
	const due = () => since + (expires - since) / 2;
	const schedule = (ms: number) => {
		clearTimeout(timer);
		timer = setTimeout(ask, Math.max(1000, ms));
	};
	const stop = () => {
		clearTimeout(timer);
		if (typeof document !== "undefined") document.removeEventListener("visibilitychange", shown);
	};
	const ask = () => {
		if (d.cancelled()) return stop();
		if (asking) return;
		asking = true;
		d.pass()
			.then((next) => {
				if (d.cancelled()) return stop();
				since = Date.now();
				expires = next.expires;
				d.renewed(next);
				schedule(due() - Date.now());
			})
			.catch(() => schedule(RETRY_MS))
			.finally(() => (asking = false));
	};
	schedule(due() - Date.now());
	function shown() {
		if (d.cancelled()) return stop();
		if (typeof document !== "undefined" && document.visibilityState === "visible" && Date.now() >= due()) ask();
	}
	if (typeof document !== "undefined") document.addEventListener("visibilitychange", shown);
}
