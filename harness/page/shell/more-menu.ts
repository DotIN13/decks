import type { Page } from "../state/types/index.ts";
import Eraser from "lucide-solid/icons/eraser";
import Info from "lucide-solid/icons/info";
import Moon from "lucide-solid/icons/moon";
import SettingsIcon from "lucide-solid/icons/settings";
import { scheme, toggleScheme } from "../lib/theme.ts";
import { act } from "../state/decks.ts";
import { call } from "../state/line.ts";
import { setOps, setSettings } from "../state/ui.ts";

/**
 * What `⋯` holds: clearing the canvas, then the app's own: dark mode, the shortcuts and the settings.
 * Highlighting is the pointer's menu now, Fit the zoom bar's, and the context reading the composer's
 * (a phone's ⋯ adds it back, `TopRight.tsx`).
 */
export const moreItems = (canvasPages: () => Page[]) => [
	{
		label: "Clear the canvas",
		icon: Eraser,
		disabled: canvasPages().length === 0,
		onPick: () => {
			const paths = canvasPages().map((page) => page.path);
			if (paths.length) void act("item.batch", { ops: paths.map((path) => ({ op: "delete", id: path })) });
		},
	},
	{ label: "Dark mode", icon: Moon, rule: true, checked: scheme() === "dark", onPick: () => toggleScheme() },
	{ label: "Shortcuts", icon: Info, onPick: () => setOps(true) },
	{
		label: "Settings",
		icon: SettingsIcon,
		onPick: () => {
			setSettings(true);
			void call("account.list", { limits: true });
		},
	},
];
