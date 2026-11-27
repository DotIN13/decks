import { m } from "@decks/i18n";
import Info from "lucide-solid/icons/info";
import Moon from "lucide-solid/icons/moon";
import SettingsIcon from "lucide-solid/icons/settings";
import { scheme, toggleScheme } from "../lib/theme.ts";
import { call } from "../state/socket.ts";
import { setOps, setSettings } from "../state/ui.ts";

/**
 * What `⋯` holds: the app's own. Highlighting is the pointer's menu now. Fit is the zoom bar's, and the
 * context reading the composer's (a phone's ⋯ adds it back, `TopRight.tsx`).
 *
 * "Highlight on hover" is the canvas's mode: on (`edit`), what is under the pointer is outlined,
 * a flow board shows its blocks' grips, and Alt shows distances; off (`browse`), nothing lights
 * up and everything still moves, sizes and snaps.
 */
export const moreItems = () => [
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
];
