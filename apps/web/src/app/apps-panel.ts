import { m } from "@decks/i18n";
import type { Page } from "@decks/protocol";
import { createSignal } from "solid-js";
import type { AppAction, PanelApp } from "../panel/AppRow.tsx";
import { ask } from "../state/confirm.ts";
import { act } from "../state/decks.ts";
import { setSelected } from "../state/selection.ts";
import { flyToPages } from "./links.ts";

/** The deck's apps, for the panel's Apps tab: asked for each time the tab opens. */
export function createAppsPanel(stagePages: () => Page[], frameWhenPlaced: (path: string) => void) {
	const [apps, setApps] = createSignal<PanelApp[] | undefined>();
	const loadApps = () =>
		void act<Array<{ name: string; title?: string; status: string; board: string }>>("apps.list", []).then((list) => {
			if (list) setApps(list.map((app) => ({ name: app.name, title: app.title || app.name, status: app.status, board: app.board })));
		});
	const onApp = async (app: PanelApp, action: AppAction) => {
		const running = app.status === "running" || app.status === "asleep";
		/*
		 * The item that shows it: the one on the canvas already, or a new one where nothing else is, and
		 * the camera flown to it, the item chosen. Asked of the canvas, since an app's item has no page in
		 * the deck's list (`stagePages` holds only cards): looked for there, it was never found, so each
		 * Show put another copy down, on top of whatever was beside the newest card, and flew nowhere.
		 */
		const show = async () => {
			type Placed = { id?: string; metadata?: { type?: string; name?: string }; box?: { x1: number; y1: number; x2: number; y2: number } };
			const read = await act<{ items: Placed[] }>("canvas.read", [{ depth: 0 }]);
			let item = read?.items.find((one) => one.metadata?.type === "decks.app" && one.metadata.name === app.name);
			if (!item) {
				const at = await act<{ x1: number; y1: number }>("canvas.space", [{ w: 1100, h: 760 }]);
				item = await act<Placed>("canvas.insert", [{ type: "app", app: app.name }, ...(at ? [{ at }] : [])]);
			}
			if (!item?.id || !item.box) return;
			const { x1, y1, x2, y2 } = item.box;
			const path = `item:${item.id}`;
			setSelected(path);
			flyToPages([{ path, x: x1, y: y1, w: x2 - x1, h: y2 - y1 } as Page], { animate: true });
		};
		if (action === "show") return show();
		if (action === "run-show") {
			if (!running) await act("apps.run", [app.name]);
			loadApps();
			return show();
		}
		// Its page loads again in every window showing it, on a canvas or in a tab; the app itself is left running as it is.
		if (action === "reload") return act("apps.reload", [app.name]);
		if (action === "delete") {
			const yes = await ask({ title: m.app_delete_app_title({ name: app.title }), body: m.app_delete_app_body({ folder: app.name }), yes: m.app_delete(), no: m.app_cancel(), danger: true });
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
