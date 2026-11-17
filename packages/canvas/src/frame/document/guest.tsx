import { life, sayShared } from "@decks/frame";
import { dismissMenus } from "@decks/ui";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { setCanvasHost } from "../../base/host.ts";
import { setCanvasScheme } from "../../base/theme.ts";
import { DocumentSurface } from "../../items/item-surfaces.tsx";
import { createBackend } from "../inside/backend.ts";
import type { DocumentEnd, DocumentStart } from "./protocol.ts";

/** How wide the page is at most: a line of words is read, not scanned across a whole window. */
const WIDEST = 980;

/**
 * Run one document in the frame, whole: the document's own surface (`items/item-surfaces.tsx`), as on a
 * canvas, filling the window to a readable width, down to the composer. Its messages go to the harness
 * on a line of its own, opened with its document pass, which watches no canvas; what the harness says
 * of the document comes back on it. Its markdown and maths are read from the harness's public `lib/`.
 * Answers how to stop it.
 */
export async function runDocument(root: HTMLElement, start: DocumentStart, end: DocumentEnd): Promise<() => void> {
	const backend = createBackend(start.backend.api, "", start.backend.token);
	end.on("token", (data) => backend.setToken(data.token));

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

	// The document's line: what the editor says goes to the harness, and what the harness says of documents comes to the editor.
	const listeners = new Set<(message: unknown) => void>();
	const stopFollowing = backend.follow((message) => {
		if (message.type.startsWith("doc.")) for (const listener of listeners) listener(message);
	});
	setCanvasHost({
		fileUrl: (path) => path,
		canWrite: () => true,
		openLink: (href) => end.emit("open-link", { href }),
		documents: {
			send: (message: unknown) => void backend.post("doc", { frame: backend.frame, message }).then((answer) => answer.ok === false && console.warn(answer.error)),
			listen: (listener: (message: unknown) => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			lib: `${start.backend.api.replace(/\/+$/, "")}/lib/`,
		},
	});

	const dispose = render(
		() => (
			<div class="document-tab" style={{ position: "absolute", inset: `0 0 ${foot()}px 0`, display: "flex", "justify-content": "center", background: "var(--canvas-bg)" }}>
				<div class="document-tab-page" style={{ position: "relative", width: "100%", "max-width": `${WIDEST}px`, height: "100%" }}>
					<DocumentSurface file={start.document.path} selected onSelect={() => {}} />
				</div>
			</div>
		),
		root,
	);
	return () => {
		stopFollowing();
		dispose();
		end.close();
	};
}
