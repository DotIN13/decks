import type { Page } from "@decks/protocol";
import { createSignal } from "solid-js";
import type { AppAction, PanelApp } from "../panel/AppRow.tsx";
import { ask } from "../state/confirm.ts";
import { act } from "../state/decks.ts";

/** The deck's apps, for the panel's Apps tab: asked for each time the tab opens. */
export function createAppsPanel(stagePages: () => Page[], frameWhenPlaced: (path: string) => void) {
	const [apps, setApps] = createSignal<PanelApp[] | undefined>();
	const loadApps = () =>
		void act<Array<{ name: string; title?: string; status: string; board: string }>>("apps.list", []).then((list) => {
			if (list) setApps(list.map((app) => ({ name: app.name, title: app.title || app.name, status: app.status, board: app.board })));
		});
	const onApp = async (app: PanelApp, action: AppAction) => {
		const running = app.status === "running" || app.status === "asleep";
		/* The item that shows it: the one on the canvas already, or a new one beside the newest thing there. */
		const show = async () => {
			const here = stagePages().find((one) => one.app === app.name);
			if (here) return frameWhenPlaced(here.path);
			const placed = await act<{ id?: string }>("canvas.insert", [{ type: "app", app: app.name }]);
			if (placed?.id) frameWhenPlaced(`item:${placed.id}`);
		};
		if (action === "show") return show();
		if (action === "run-show") {
			if (!running) await act("apps.run", [app.name]);
			loadApps();
			return show();
		}
		if (action === "delete") {
			const yes = await ask({ title: `Delete ${app.title}?`, body: `Its folder, apps/${app.name}, moves to the deck's trash, and the items showing it leave the canvases.`, yes: "Delete", no: "Cancel" });
			if (!yes) return;
			await act("apps.delete", [app.name]);
			return loadApps();
		}
		await act(action === "start" ? "apps.run" : action === "stop" ? "apps.stop" : "apps.restart", [app.name]);
		loadApps();
	};
	const onAppLogs = (app: PanelApp) => act<string[]>("apps.logs", [app.name, { tail: 80 }]);
	return { apps, loadApps, onApp, onAppLogs };
}
