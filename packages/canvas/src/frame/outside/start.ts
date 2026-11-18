import type { Camera } from "@decks/protocol";
import { untrack } from "solid-js";
import type { EditorState } from "../../view/types.ts";
import { insets } from "../../camera/insets.ts";
import { awaitHello, renewPass, sendStart } from "@decks/frame";
import { PROTOCOL, peer, type PageEnd, type Start } from "../protocol.ts";
import { type CanvasPass, type FramedEditorOptions, } from "./host.tsx";
import { FRAME_VIEWS } from "./stores.ts";

/** What `createStart` reads of `createFramedEditor` (`host.tsx`), each read when it is used. */
export interface StartNeeds {
	readonly options: FramedEditorOptions;
	readonly state: EditorState | undefined;
	readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
	readonly storeKey: (canvas: string) => string;
	readonly darkNow: boolean;
	readonly modeNow: "edit" | "browse";
	readonly localCamera: Camera;
	readonly appStoredNow: () => Record<string, Record<string, string>>;
	readonly wire: (page: PageEnd, canvas: string) => void;
}

export function createStart(d: StartNeeds) {
	/**
	 * Start the frame on a canvas: its hello is listened for at once (a frame moved in place says it
	 * again soon after its `reset`), and the pass is asked for beside it; once both are here, the frame
	 * gets everything it begins with, and `started` is handed the page's end of its line: the frame may
	 * be the one in front by then or one kept behind it (`surface.tsx`). Answers how to stop waiting, for
	 * a canvas left before it started.
	 */
	const startFrame = (frame: HTMLIFrameElement, canvas: string, cancelled: () => boolean, started: (page: PageEnd, selected: string | undefined) => void): (() => void) => {
		const begin = (pass: CanvasPass) => {
			const backend = { api: pass.api, token: pass.token, expires: pass.expires, ...(pass.kind ? { kind: pass.kind } : {}) };
			const pen = untrack(() => d.state?.pen?.());
			const stored: Record<string, string> = {};
			if (d.storage) {
				const prefix = d.storeKey(canvas);
				for (let i = 0; i < (d.storage as Storage).length; i++) {
					const key = (d.storage as Storage).key(i);
					if (key?.startsWith(prefix)) stored[key.slice(prefix.length)] = d.storage.getItem(key) ?? "";
				}
				// A harness's frame keeps no view of its own any more (the page keeps one per agent and canvas): what one kept is dropped.
				if (backend.kind !== "studio" && FRAME_VIEWS in stored) {
					delete stored[FRAME_VIEWS];
					d.storage.removeItem(prefix + FRAME_VIEWS);
				}
			}
			const start: Start = {
				protocol: PROTOCOL,
				canvas: { name: canvas, role: d.options.frame.role?.(canvas) ?? "owner" },
				backend,
				files: { base: pass.files, expires: pass.expires },
				pictures: pass.pictures,
				...(pass.imports ? { imports: pass.imports } : {}),
				look: { dark: d.darkNow, mode: d.modeNow, readOnly: d.options.readOnly === true, toolbar: d.options.toolbar !== false, insets: untrack(insets), ...(d.options.onComment ? { pageComments: true } : {}), ...(d.options.frame.openTab ? { pageTabs: true } : {}), ...(d.options.pageTools ? { pageTools: true, ...(d.options.pageKeys ? { pageKeys: [...d.options.pageKeys] } : {}), ...(d.options.pageKeysFirst ? { pageKeysFirst: [...d.options.pageKeysFirst] } : {}) } : {}), ...(untrack(() => d.options.frame.agents?.()) ? { agents: untrack(() => d.options.frame.agents!())! } : {}), ...(untrack(() => d.options.frame.focused?.()) ? { agent: untrack(() => d.options.frame.focused!())! } : {}) },
				camera: d.localCamera,
				...(pen?.writer ? { writer: pen.writer } : {}),
				stored,
				appStored: d.appStoredNow(),
			};
			const channel = new MessageChannel();
			const page = peer(channel.port1) as PageEnd;
			// A new frame has said nothing yet, and starts with the page's selection (`start.selected`), so it is not sent again.
			const selected = untrack(() => d.state?.selected?.[0]());
			d.wire(page, canvas);
			started(page, selected);
			// The canvas pass, kept current for as long as the frame is there (`renewPass`): the frame takes the new one for its calls, and the new addresses for its files and pictures.
			renewPass({ pass: () => d.options.frame.pass(canvas), expires: pass.expires, cancelled, renewed: (next) => page.emit("token", { token: next.token, files: { base: next.files, expires: next.expires }, pictures: next.pictures }) });
			// The camera as it is now: the page may have landed while the frame was loading.
			sendStart<Start>(frame, { ...start, camera: d.localCamera, ...(selected ? { selected } : {}) } as Start, channel.port2);
		};
		// The frame's hello and its pass, as for every frame (`@decks/frame`); then what a canvas starts from.
		return awaitHello(frame, { pass: () => d.options.frame.pass(canvas), cancelled, begin });
	};

	return {
		startFrame,
	};
}
