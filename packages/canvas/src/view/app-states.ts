import { createEffect, createSignal, onCleanup } from "solid-js";
import { canvasHost } from "../base/host.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";

/** What `createAppStates` reads of `createItemsLayer` (`items-layer.tsx`), each read when it is used. */
export interface AppStatesNeeds {
	readonly props: CanvasViewProps;
}

export function createAppStates(d: AppStatesNeeds) {
	/**
	 * Each app's status, by name, for the dot on the window the engine paints: read once per app on the
	 * canvas and then heard from the harness as it changes (`CanvasHost.apps.watch`).
	 */
	const [appStates, setAppStates] = createSignal<ReadonlyMap<string, string>>(new Map());

	const appWatched = new Map<string, () => void>();

	createEffect(() => {
		const apps = canvasHost().apps;
		const names = new Set(d.props.boards.filter((board) => board.item === "app" && board.app).map((board) => board.app!));
		for (const [name, stop] of appWatched) {
			if (names.has(name)) continue;
			stop();
			appWatched.delete(name);
		}
		for (const name of names) {
			if (appWatched.has(name) || !apps) continue;
			const put = (status: string | undefined) => status && setAppStates((was) => (was.get(name) === status ? was : new Map(was).set(name, status)));
			void apps.status(name).then((got) => put(got?.status)).catch(() => {});
			appWatched.set(name, apps.watch?.(name, (state) => put(state.status)) ?? (() => {}));
		}
	});

	onCleanup(() => {
		for (const stop of appWatched.values()) stop();
	});

	return {
		appStates,
	};
}
