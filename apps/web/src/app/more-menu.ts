import { m } from "@decks/i18n";
import type { Page } from "@decks/protocol";
import Eraser from "lucide-solid/icons/eraser";
import Info from "lucide-solid/icons/info";
import Moon from "lucide-solid/icons/moon";
import SettingsIcon from "lucide-solid/icons/settings";
import { scheme, toggleScheme } from "../lib/theme.ts";
import { ask } from "../state/confirm.ts";
import { act } from "../state/decks.ts";
import { call } from "../state/socket.ts";
import { setOps, setSettings } from "../state/ui.ts";

/**
 * What `⋯` holds: the app's own, then, last and asked first, removing every card from the canvas. Highlighting is the pointer's menu now. Fit is the zoom bar's, and the
 * context reading the composer's (a phone's ⋯ adds it back, `TopRight.tsx`).
 *
 * "Highlight on hover" is the canvas's mode: on (`edit`), what is under the pointer is outlined,
 * a flow board shows its blocks' grips, and Alt shows distances; off (`browse`), nothing lights
 * up and everything still moves, sizes and snaps.
 */
export const moreItems = (stagePages: () => Page[]) => [
	{ label: m.app_dark_mode(), icon: Moon, checked: scheme() === "dark", onPick: () => toggleScheme() },
	{ label: m.app_shortcuts(), icon: Info, onPick: () => setOps(true) },
	{
		label: m.app_settings(),
		icon: SettingsIcon,
		onPick: () => {
			setSettings(true);
			void call("account.list", [{ limits: true }]);
		},
	},
	// Last, below a rule, and asked first: it takes every card off the canvas (the drawing stays).
	{
		label: m.app_clear_canvas(),
		icon: Eraser,
		rule: true,
		disabled: stagePages().length === 0,
		onPick: async () => {
			const paths = stagePages().map((board) => board.path);
			if (!paths.length) return;
			const yes = await ask({ title: m.app_clear_canvas_ask_title({ count: paths.length }), body: m.app_clear_canvas_ask_body(), yes: m.app_clear_canvas_ask_yes(), no: m.app_cancel(), danger: true });
			if (yes) void act("canvas.batch", [paths.map((path) => ({ op: "delete", id: path }))]);
		},
	},
];
