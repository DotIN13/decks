import Bell from "lucide-solid/icons/bell";
import Mic from "lucide-solid/icons/mic";
import Plug from "lucide-solid/icons/plug";
import Puzzle from "lucide-solid/icons/puzzle";
import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import User from "lucide-solid/icons/user";
import X from "lucide-solid/icons/x";
import { For, Match, Show, Switch, type JSX } from "solid-js";
import type { AlertPrefs } from "../../alerts/index.ts";
import { Icon } from "@decks/ui";
import type { ClaudeAccount, WebStatus } from "../../state/types/index.ts";
import { AlertSettings } from "../AlertSettings.tsx";
import { Accounts, CanvasSettings, Connections, TimeSettings, VoiceSettings, YourChrome } from "../sections/view.tsx";
import { createWindow } from "./actions.ts";
import { labelOf, SECTIONS, type Section } from "./model.ts";

// Settings: a window with its sections down the left on a computer, a sheet
// with tabs across the top on a phone, and the open section's rows.

export type SettingsProps = {
	prefs: AlertPrefs;
	onPrefs: (prefs: AlertPrefs) => void;
	accounts: ClaudeAccount[];
	active: string;
	onAdd: () => void;
	onForget: (id: string) => void;
	web?: { status: WebStatus; code?: string };
	onWebRepair: () => void;
	onWebStop: () => void;
	phone?: boolean;
	onClose: () => void;
};

const ICONS: Record<Section, typeof Bell> = { general: SlidersHorizontal, notifications: Bell, accounts: User, voice: Mic, connections: Plug, chrome: Puzzle };
type W = { props: SettingsProps; w: ReturnType<typeof createWindow> };

function Body(p: W): JSX.Element {
	const is = (id: Section) => p.w.section() === id;
	return (
		<div class="sw-body">
			<Switch>
				<Match when={is("general")}>
					<TimeSettings />
					<CanvasSettings />
				</Match>
				<Match when={is("notifications")}>
					<AlertSettings prefs={p.props.prefs} onChange={p.props.onPrefs} />
				</Match>
				<Match when={is("accounts")}>
					<Accounts accounts={p.props.accounts} active={p.props.active} onAdd={p.props.onAdd} onForget={p.props.onForget} />
				</Match>
				<Match when={is("voice")}>
					<VoiceSettings />
				</Match>
				<Match when={is("connections")}>
					<Connections />
				</Match>
				<Match when={is("chrome")}>
					<YourChrome web={p.props.web} onRepair={p.props.onWebRepair} onStop={p.props.onWebStop} />
				</Match>
			</Switch>
		</div>
	);
}

function Window(p: W): JSX.Element {
	return (
		<div class="settings sw-win" role="dialog" aria-label="Settings">
			<nav class="sw-nav" aria-label="Sections">
				<span class="sw-nav-title">Settings</span>
				<For each={SECTIONS}>
					{(one) => (
						<button type="button" data-section={one.id} data-on={p.w.section() === one.id} aria-current={p.w.section() === one.id ? "page" : undefined} onClick={() => p.w.open(one.id)}>
							<Icon of={ICONS[one.id]} size={15} />
							{one.label}
						</button>
					)}
				</For>
			</nav>
			<div class="sw-pane">
				<header class="sw-head">
					<span class="sw-title">{labelOf(p.w.section())}</span>
					<span class="flex-1" />
					<button class="sw-x" type="button" title="Close" aria-label="Close" onClick={p.props.onClose}>
						<Icon of={X} size={16} />
					</button>
				</header>
				<Body {...p} />
			</div>
		</div>
	);
}

function Sheet(p: W): JSX.Element {
	return (
		<div class="settings sw-sheet" role="dialog" aria-label="Settings">
			<header class="sw-head">
				<span class="sw-title">Settings</span>
				<span class="flex-1" />
				<button class="sw-done" type="button" onClick={p.props.onClose}>
					Done
				</button>
			</header>
			<div class="sw-tabs" role="tablist" ref={(el) => (p.w.tabs.el = el)}>
				<Show when={p.w.mark()}>{(at) => <span class="sw-tab-mark" style={{ left: `${at().left}px`, width: `${at().width}px` }} />}</Show>
				<For each={SECTIONS}>
					{(one) => (
						<button type="button" role="tab" data-section={one.id} data-on={p.w.section() === one.id} aria-selected={p.w.section() === one.id} onClick={() => p.w.open(one.id)}>
							<Icon of={ICONS[one.id]} size={15} />
							{one.label}
						</button>
					)}
				</For>
			</div>
			<Body {...p} />
		</div>
	);
}

export function Settings(props: SettingsProps): JSX.Element {
	const w = createWindow(props);
	return (
		<div class="picker-backdrop sw-backdrop" data-layout={props.phone ? "sheet" : "window"} onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}>
			<Show when={props.phone} fallback={<Window props={props} w={w} />}>
				<Sheet props={props} w={w} />
			</Show>
		</div>
	);
}
