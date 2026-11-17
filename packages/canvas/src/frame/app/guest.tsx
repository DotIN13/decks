import { ALLOW, SANDBOX, life, sayShared } from "@decks/frame";
import { dismissMenus } from "@decks/ui";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { setCanvasScheme } from "../../base/theme.ts";
import type { AppEnd, AppStart } from "./protocol.ts";

/** What the app saved, as its address carries it after `#`, which never reaches the server (`decks-canvas.js` reads it). */
function carried(stored: Record<string, string>): string {
	if (!Object.keys(stored).length) return "";
	const bytes = new TextEncoder().encode(JSON.stringify(stored));
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `#decks-storage=${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/**
 * Run one app in the frame, whole: its own page in a frame inside this one, filling the window down to
 * the composer, sandboxed as this frame is and no further. What its page saves in its browser storage
 * comes here as a message (`decks-canvas.js`, which the harness puts into every page it serves by this
 * address) and is said up to the page, which keeps it. Answers how to stop it.
 */
export async function runApp(root: HTMLElement, start: AppStart, end: AppEnd): Promise<() => void> {
	const [foot, setFoot] = createSignal(start.look.foot);
	const look = (dark: boolean) => {
		document.documentElement.dataset.colorScheme = dark ? "dark" : "light";
		setCanvasScheme(dark ? "dark" : "light");
	};
	look(start.look.dark);
	end.on("look", (data) => {
		look(data.dark);
		setFoot(data.foot);
	});
	sayShared(end as never, { dismiss: dismissMenus, signal: life() });

	let frame: HTMLIFrameElement | undefined;
	const onMessage = (event: MessageEvent) => {
		if (!frame || event.source !== frame.contentWindow) return;
		const data = event.data as { type?: unknown; key?: unknown; value?: unknown } | null;
		if (data?.type !== "decks-storage" || typeof data.key !== "string") return;
		end.emit("app-store", { key: data.key, value: typeof data.value === "string" ? data.value : null });
	};
	addEventListener("message", onMessage);

	const dispose = render(
		() => (
			<div class="app-tab" style={{ position: "absolute", inset: `0 0 ${foot()}px 0`, background: "var(--canvas-bg)" }}>
				<iframe
					ref={(element) => (frame = element)}
					class="app-tab-frame"
					title={start.app.title}
					src={`${start.app.url}${carried(start.app.stored)}`}
					/* The one list every frame has (`@decks/frame`, `sandbox.ts`): no more than this frame around it. */
					sandbox={SANDBOX}
					allow={ALLOW}
					style={{ position: "absolute", inset: "0", width: "100%", height: "100%", border: "0", display: "block", background: "#fff" }}
				/>
			</div>
		),
		root,
	);
	return () => {
		removeEventListener("message", onMessage);
		dispose();
		end.close();
	};
}
