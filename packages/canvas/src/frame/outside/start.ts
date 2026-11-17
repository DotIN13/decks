import type { Setter } from "solid-js";
import type { Camera } from "@decks/protocol";
import { untrack } from "solid-js";
import type { EditorState } from "../../view/types.ts";
import { insets } from "../../camera/insets.ts";
import { PROTOCOL, peer, type PageEnd, type Start } from "../protocol.ts";
import { type CanvasPass, type FramedEditorOptions, } from "./host.tsx";
import { FRAME_VIEWS } from "./stores.ts";

/** How long after a failed renewal it is asked for again. */
const RETRY_MS = 30_000;

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
	fromFrame: { camera?: Camera; selected?: string; mode?: "edit" | "browse"; };
	readonly wire: (page: PageEnd, canvas: string) => void;
	readonly setEnd: Setter<PageEnd | undefined>;
}

export function createStart(d: StartNeeds) {
	/**
	 * Start the frame on a canvas: its hello is listened for at once (a frame moved in place says it
	 * again soon after its `reset`), and the pass is asked for beside it; once both are here, the frame
	 * gets everything it begins with. Answers how to stop waiting, for a canvas left before it started.
	 */
	const startFrame = (frame: HTMLIFrameElement, canvas: string, cancelled: () => boolean): (() => void) => {
		let said = false;
		let pass: CanvasPass | undefined;
		const onHello = (event: MessageEvent) => {
			if (event.source !== frame.contentWindow || event.data?.t !== "hello") return;
			removeEventListener("message", onHello);
			said = true;
			if (pass) begin(pass);
		};
		addEventListener("message", onHello);
		void d.options.frame.pass(canvas).then(
			(got) => {
				if (cancelled()) return;
				pass = got;
				if (said) begin(got);
			},
			(error: unknown) => console.error(error),
		);
		const begin = (pass: CanvasPass) => {
			if (cancelled()) return;
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
				look: { dark: d.darkNow, mode: d.modeNow, readOnly: d.options.readOnly === true, toolbar: d.options.toolbar !== false, insets: untrack(insets), ...(d.options.onComment ? { pageComments: true } : {}), ...(d.options.pageTools ? { pageTools: true, ...(d.options.pageKeys ? { pageKeys: [...d.options.pageKeys] } : {}) } : {}), ...(untrack(() => d.options.frame.agents?.()) ? { agents: untrack(() => d.options.frame.agents!())! } : {}), ...(untrack(() => d.options.frame.focused?.()) ? { agent: untrack(() => d.options.frame.focused!())! } : {}) },
				camera: d.localCamera,
				...(pen?.writer ? { writer: pen.writer } : {}),
				stored,
				appStored: d.appStoredNow(),
			};
			const channel = new MessageChannel();
			const page = peer(channel.port1) as PageEnd;
			// A new frame has said nothing yet, and starts with the page's selection (`start.selected`), so it is not sent again.
			const selected = untrack(() => d.state?.selected?.[0]());
			d.fromFrame = selected ? { selected } : {};
			d.wire(page, canvas);
			d.setEnd(page);
			renew(page, canvas, pass.expires, cancelled);
			// To this frame's window alone: a sandboxed page has no origin to name, so "*", and the port beside it.
			// A plain copy: the pages come from the host's store, whose proxies the structured clone refuses.
			// The camera as it is now: the page may have landed while the frame was loading.
			frame.contentWindow?.postMessage({ t: "start", start: JSON.parse(JSON.stringify({ ...start, camera: d.localCamera, ...(selected ? { selected } : {}) })) as Start }, "*", [channel.port2]);
		};
		return () => removeEventListener("message", onHello);
	};

	/**
	 * The canvas pass, asked for again unseen at half its life, for as long as the frame is there; and
	 * at once when the tab is shown again past that, since a hidden tab's timers are held back. One
	 * that fails is asked for again in thirty seconds. The frame takes the new pass for its calls and
	 * the new addresses for its files and pictures (`token`); what it already loaded stays loaded.
	 */
	const renew = (page: PageEnd, canvas: string, firstExpires: number, cancelled: () => boolean) => {
		let expires = firstExpires;
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
			if (cancelled()) return stop();
			if (asking) return;
			asking = true;
			d.options.frame
				.pass(canvas)
				.then((next) => {
					if (cancelled()) return stop();
					since = Date.now();
					expires = next.expires;
					page.emit("token", { token: next.token, files: { base: next.files, expires: next.expires }, pictures: next.pictures });
					schedule(due() - Date.now());
				})
				.catch(() => schedule(RETRY_MS))
				.finally(() => (asking = false));
		};
		schedule(due() - Date.now());
		function shown() {
			if (cancelled()) return stop();
			if (typeof document !== "undefined" && document.visibilityState === "visible" && Date.now() >= due()) ask();
		}
		if (typeof document !== "undefined") document.addEventListener("visibilitychange", shown);
	};

	return {
		startFrame,
	};
}
