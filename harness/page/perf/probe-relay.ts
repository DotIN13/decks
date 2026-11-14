/*
 * The page's side of the frame probe (`probe.ts`, which runs in the canvas frame, where the stage is):
 * with `?probe` on the page, `__probeEval(expression)` runs an expression in the canvas frame and
 * resolves to its value, awaited, so an inspector or WebDriver on the page (`scripts/ipad-profile.mjs`)
 * reaches the frame's `__pilot`, `__decksSheet` and clock. Nothing runs without the parameter.
 */
if (new URLSearchParams(location.search).get("probe")) {
	let next = 0;
	const waiting = new Map<number, { done: (value: unknown) => void; failed: (error: Error) => void }>();
	window.addEventListener("message", (event) => {
		const m = event.data as { t?: string; id?: number; value?: unknown; error?: string } | null;
		if (m?.t !== "decks:probe-result" || typeof m.id !== "number") return;
		const one = waiting.get(m.id);
		if (!one) return;
		waiting.delete(m.id);
		if (m.error !== undefined) one.failed(new Error(m.error));
		else one.done(m.value);
	});
	(globalThis as { __probeEval?: unknown }).__probeEval = (expression: string) =>
		new Promise((done, failed) => {
			const frame = document.querySelector<HTMLIFrameElement>("iframe.canvas-frame")?.contentWindow;
			if (!frame) return failed(new Error("no canvas frame on the page"));
			const id = ++next;
			waiting.set(id, { done, failed });
			frame.postMessage({ t: "decks:probe-eval", id, expression }, "*");
		});
}

export {};
