import type { Page } from "@decks/protocol";
import Eraser from "lucide-solid/icons/eraser";
import Info from "lucide-solid/icons/info";
import Moon from "lucide-solid/icons/moon";
import SettingsIcon from "lucide-solid/icons/settings";
import { scheme, toggleScheme } from "../lib/theme.ts";
import { act } from "../state/decks.ts";
import { send } from "../state/socket.ts";
import { setOps, setSettings } from "../state/ui.ts";

/**
 * What `⋯` holds: clearing the canvas, then the app's own. Highlighting is the pointer's menu now. Fit is the zoom bar's, and the
 * context reading the composer's (a phone's ⋯ adds it back, `TopRight.tsx`).
 *
 * "Highlight on hover" is the canvas's mode: on (`edit`), what is under the pointer is outlined,
 * a flow board shows its blocks' grips, and Alt shows distances; off (`browse`), nothing lights
 * up and everything still moves, sizes and snaps.
 */
export const moreItems = (stagePages: () => Page[]) => [
	{
		label: "Clear the canvas",
		icon: Eraser,
		disabled: stagePages().length === 0,
		onPick: () => {
			const paths = stagePages().map((board) => board.path);
			if (paths.length) void act("canvas.batch", [paths.map((path) => ({ op: "delete", id: path }))]);
		},
	},
	{ label: "Dark mode", icon: Moon, rule: true, checked: scheme() === "dark", onPick: () => toggleScheme() },
	{ label: "Shortcuts", icon: Info, onPick: () => setOps(true) },
	{
		label: "Settings",
		icon: SettingsIcon,
		onPick: () => {
			setSettings(true);
			send({ type: "claude.accounts", limits: true });
		},
	},
];
