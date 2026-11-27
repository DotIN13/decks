import { type AgentView } from "../camera/agent-view.ts";
import { type AgentViews } from "../camera/agent-views.ts";
import type { Accessor, Setter } from "solid-js";
import { type PenDocument } from "@decks/pen";
import type { Camera } from "@decks/protocol";
import { createEffect, createRoot, on, untrack } from "solid-js";
import { viewToPark } from "../camera/agent-view.ts";
import { penSelection, setPenSelection } from "../edit/pen-tools.ts";
import type { EditorOptions } from "./types.ts";

/** What `createEditorCamera` reads of `createEditor` (`editor.tsx`). */
export interface EditorCameraNeeds {
	readonly setCameraSignal: Setter<Camera>;
	readonly options: EditorOptions;
	readonly views: AgentViews | undefined;
	readonly camera: Accessor<Camera>;
	readonly kept: (scope: string | undefined, d: PenDocument, scheme: "light" | "dark") => AgentView | undefined;
	readonly doc: Accessor<PenDocument>;
	readonly look: () => "light" | "dark";
}

/** The editor's camera: where the host asked it to look, and each agent's view parked and brought back. */
export function createEditorCamera(d: EditorCameraNeeds) {
	const setCamera = (next: Camera) => {
		d.setCameraSignal(next);
		d.options.onCamera?.(next);
	};

	/*
	 * The camera the host put the canvas at (`setCamera`, `glide`, `fit`), if it has: what the canvas opens on
	 * when its cards first arrive, rather than the camera it was made with. A canvas frame is made with the
	 * page's camera as it was, and the page's landing can reach it before its cards do; opening on the
	 * camera it was made with then undid the landing, and the frame told the page so.
	 */
	let asked: Camera | undefined;

	const putCamera = (next: Camera) => {
		asked = next;
		setCamera(next);
	};

	/*
	 * Park the view under its scope as the camera moves (a little after it stops), when the scope
	 * changes, when the page goes and when the canvas is unmounted; bring the new scope's back.
	 */
	const park = (scope: string | undefined) => {
		if (scope && d.views) d.views.keep(scope, undefined, viewToPark(untrack(d.camera), untrack(penSelection)[0]));
	};

	let parkTimer: ReturnType<typeof setTimeout> | undefined;

	const disposeViews = d.options.views
		? createRoot((done) => {
				const scope = d.options.views!.scope;
				createEffect(
					on(scope, (next, prev) => {
						if (prev) park(prev);
						const v = d.kept(next, untrack(d.doc), untrack(d.look));
						if (!v) return;
						setCamera(v.camera);
						if (v.selected) setPenSelection([v.selected]);
					}, { defer: true }),
				);
				createEffect(
					on(d.camera, () => {
						clearTimeout(parkTimer);
						const at = untrack(scope);
						parkTimer = setTimeout(() => park(at), 400);
					}, { defer: true }),
				);
				const onHide = () => park(untrack(scope));
				addEventListener("pagehide", onHide);
				return () => {
					clearTimeout(parkTimer);
					park(untrack(scope));
					removeEventListener("pagehide", onHide);
					done();
				};
			})
		: undefined;

	return {
		get asked() {
			return asked;
		},
		set asked(next) {
			asked = next;
		},
		setCamera,
		putCamera,
		disposeViews,
	};
}
