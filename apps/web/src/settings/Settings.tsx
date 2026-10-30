import { chooseShowFps, showFps } from "../perf/fps.tsx";
import { STT_MODELS, type ClaudeAccount, type PairedRow, type WebStatus } from "@decks/protocol";
import { RECOGNISERS, recogniser, setRecogniser, setVoiceLang, VOICE_LANGS, voiceLang } from "../chat/composer/voice.ts";
import Bell from "lucide-solid/icons/bell";
import Cloud from "lucide-solid/icons/cloud";
import Globe from "lucide-solid/icons/globe";
import Mic from "lucide-solid/icons/mic";
import Plug from "lucide-solid/icons/plug";
import Plus from "lucide-solid/icons/plus";
import Puzzle from "lucide-solid/icons/puzzle";
import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import User from "lucide-solid/icons/user";
import X from "lucide-solid/icons/x";
import { createEffect, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js";
import { SetGroup, SetRow, SetSegments, SetSelect } from "./rows.tsx";
import { Icon } from "../ui/icons.tsx";
import { browserZone, clockTime } from "../lib/time.ts";
import { usageLevel } from "../lib/context-usage.ts";
import { state } from "../state/deck.ts";
import { send } from "../state/socket.ts";
import { can, pairing } from "../connections/backend.ts";
import { AlertSettings } from "../alerts/AlertSettings.tsx";
import type { AlertPrefs } from "../alerts/policy.ts";

/** The six sections, in the order the left of the window lists them. */
const SECTIONS = [
	{ id: "general", label: "General", icon: SlidersHorizontal },
	{ id: "notifications", label: "Notifications", icon: Bell },
	{ id: "accounts", label: "Accounts", icon: User },
	{ id: "voice", label: "Voice", icon: Mic },
	{ id: "connections", label: "Connections", icon: Plug },
	{ id: "chrome", label: "Chrome", icon: Puzzle },
] as const;
type Section = (typeof SECTIONS)[number]["id"];

/** The section open last, kept on this device: Settings opens where you left it. */
const KEY = "decks.settings.section";
const saved = (): Section => {
	try {
		const one = localStorage.getItem(KEY);
		return SECTIONS.some((section) => section.id === one) ? (one as Section) : "notifications";
	} catch {
		return "notifications";
	}
};

/**
 * Settings, one section at a time, as the "Settings redesign" drawing has it.
 *
 * On a computer and an iPad it is a window: the six sections on a grey left, the open one on the
 * right under its name and a ×. On a phone it is the app's bottom sheet, as the properties sheet
 * is: Settings and a blue Done, then the sections as the sidebar's tabs, scrolling sideways, over
 * the same rows. The rows are one vocabulary (`.sw-row`: words on the left, one control on the
 * right) and only the narrow width stacks a row's control under its words.
 *
 * A modal: opened, used, closed. A press that *begins* on the backdrop closes it, for the reason
 * `FilePicker` gives: the tap that opened it lands a `click` here afterwards.
 */
export function Settings(props: {
	/** What the app may interrupt you with (`alerts/AlertSettings.tsx`). */
	prefs: AlertPrefs;
	onPrefs: (prefs: AlertPrefs) => void;
	/** The install's Claude subscriptions; a conversation picks one in its model picker. */
	accounts: ClaudeAccount[];
	/** Where a conversation starts when nobody has chosen, from the server. */
	active: string;
	onAdd: () => void;
	onForget: (id: string) => void;
	/** The user's own Chrome, shared through the Decks extension (`server/browser/bridge.ts`). */
	web?: { status: WebStatus; code?: string };
	onWebRepair: () => void;
	onWebStop: () => void;
	/** The phone's layout: a bottom sheet with tabs instead of a window. */
	phone?: boolean;
	onClose: () => void;
}) {
	const [section, setSection] = createSignal<Section>(saved());
	const open = (id: Section) => {
		setSection(id);
		try {
			localStorage.setItem(KEY, id);
		} catch {
			/* private mode: it opens on Notifications next time */
		}
	};
	const label = () => SECTIONS.find((one) => one.id === section())!.label;

	onMount(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			event.preventDefault();
			props.onClose();
		};
		window.addEventListener("keydown", onKey);
		onCleanup(() => window.removeEventListener("keydown", onKey));
	});

	const body = () => (
		<div class="sw-body">
			<Switch>
				<Match when={section() === "general"}>
					<TimeSettings />
					<BoardSettings />
				</Match>
				<Match when={section() === "notifications"}>
					<AlertSettings prefs={props.prefs} onChange={props.onPrefs} />
				</Match>
				<Match when={section() === "accounts"}>
					<Accounts accounts={props.accounts} active={props.active} onAdd={props.onAdd} onForget={props.onForget} />
				</Match>
				<Match when={section() === "voice"}>
					<VoiceSettings />
				</Match>
				<Match when={section() === "connections"}>
					<Connections />
				</Match>
				<Match when={section() === "chrome"}>
					<YourChrome web={props.web} onRepair={props.onWebRepair} onStop={props.onWebStop} />
				</Match>
			</Switch>
		</div>
	);

	/* The phone's tabs: the open one carries the sidebar's mark and scrolls into the middle. */
	let tabs: HTMLDivElement | undefined;
	const [mark, setMark] = createSignal<{ left: number; width: number }>();
	createEffect(
		on([section, () => props.phone], () => {
			if (!props.phone) return;
			queueMicrotask(() => {
				const one = tabs?.querySelector<HTMLElement>(`[data-section="${section()}"]`);
				if (!tabs || !one) return;
				setMark({ left: one.offsetLeft, width: one.offsetWidth });
				tabs.scrollTo({ left: Math.max(0, one.offsetLeft - (tabs.clientWidth - one.offsetWidth) / 2), behavior: "smooth" });
			});
		}),
	);

	return (
		<div
			class="picker-backdrop sw-backdrop"
			data-layout={props.phone ? "sheet" : "window"}
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) props.onClose();
			}}
		>
			<Show
				when={props.phone}
				fallback={
					<div class="settings sw-win" role="dialog" aria-label="Settings">
						<nav class="sw-nav" aria-label="Sections">
							<span class="sw-nav-title">Settings</span>
							<For each={SECTIONS}>
								{(one) => (
									<button type="button" data-section={one.id} data-on={section() === one.id} aria-current={section() === one.id ? "page" : undefined} onClick={() => open(one.id)}>
										<Icon of={one.icon} size={15} />
										{one.label}
									</button>
								)}
							</For>
						</nav>
						<div class="sw-pane">
							<header class="sw-head">
								<span class="sw-title">{label()}</span>
								<span class="flex-1" />
								<button class="sw-x" type="button" title="Close" aria-label="Close" onClick={props.onClose}>
									<Icon of={X} size={16} />
								</button>
							</header>
							{body()}
						</div>
					</div>
				}
			>
				<div class="settings sw-sheet" role="dialog" aria-label="Settings">
					<header class="sw-head">
						<span class="sw-title">Settings</span>
						<span class="flex-1" />
						<button class="sw-done" type="button" onClick={props.onClose}>
							Done
						</button>
					</header>
					<div class="sw-tabs" role="tablist" ref={tabs}>
						<Show when={mark()}>{(at) => <span class="sw-tab-mark" style={{ left: `${at().left}px`, width: `${at().width}px` }} />}</Show>
						<For each={SECTIONS}>
							{(one) => (
								<button type="button" role="tab" data-section={one.id} data-on={section() === one.id} aria-selected={section() === one.id} onClick={() => open(one.id)}>
									<Icon of={one.icon} size={15} />
									{one.label}
								</button>
							)}
						</For>
					</div>
					{body()}
				</div>
			</Show>
		</div>
	);
}

/** A plain button in a row. */
function Btn(props: { children: JSX.Element; onClick: () => void; tone?: "danger"; title?: string; disabled?: boolean }) {
	return (
		<button class="sw-btn" type="button" data-tone={props.tone} title={props.title} disabled={props.disabled} onClick={props.onClick}>
			{props.children}
		</button>
	);
}

/** Copy some words, and say so on the button for a moment. */
function useCopy() {
	const [copied, setCopied] = createSignal<string>();
	const copy = async (what: string, text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(what);
			setTimeout(() => setCopied(undefined), 1500);
		} catch {
			/* no clipboard on this origin; the words are on screen to select */
		}
	};
	return { copied, copy };
}

/* ---------------------------------------------------------------------------------------- */
/* General                                                                                    */

/**
 * The deck's timezone: one zone for the whole deck, kept by the server, so schedules fire in it
 * with no browser open. Nothing is guessed: until one is chosen the server is on its machine's
 * clock, and the row says so with one button to take this browser's zone.
 */
function TimeSettings() {
	const chosen = () => state.settings.timezone;
	const mine = browserZone();
	const zones = (): string[] => {
		try {
			return (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf("timeZone");
		} catch {
			return [mine, "UTC"];
		}
	};
	const [draft, setDraft] = createSignal("");
	const [tick, setTick] = createSignal(Date.now());
	onMount(() => {
		const timer = setInterval(() => setTick(Date.now()), 30_000);
		onCleanup(() => clearInterval(timer));
	});
	const known = (zone: string) => zone === "UTC" || zones().includes(zone);
	const set = (timezone: string | null) => {
		send({ type: "settings.set", timezone });
		setDraft("");
	};
	const inForce = () => chosen() ?? state.machineZone;
	return (
		<SetGroup label="Time" group="time">
			<SetRow
				title="Timezone"
				sub={
					<span data-zone-now>
						{chosen() ? `Set to ${chosen()}.` : `Not set: the server's own clock, ${state.machineZone || "unknown"}.`} It is {clockTime(tick(), inForce() || undefined)} there.
					</span>
				}
			>
				<Show when={chosen()} fallback={<Btn onClick={() => set(mine)}>Use {mine}</Btn>}>
					<Btn title={`Back to the server's own clock, ${state.machineZone}`} onClick={() => set(null)}>
						Use the server's
					</Btn>
				</Show>
			</SetRow>
			<SetRow title="Another timezone" sub="An IANA name, such as Asia/Shanghai.">
				<input
					class="sw-field"
					list="set-zones"
					placeholder="Asia/Shanghai"
					aria-label="Timezone"
					value={draft()}
					onInput={(event) => setDraft(event.currentTarget.value.trim())}
					onKeyDown={(event) => {
						if (event.key === "Enter" && known(draft())) set(draft());
					}}
				/>
				<datalist id="set-zones">
					<For each={zones()}>{(zone) => <option value={zone} />}</For>
				</datalist>
				<Btn disabled={!known(draft()) || draft() === chosen()} onClick={() => set(draft())}>
					Set
				</Btn>
			</SetRow>
		</SetGroup>
	);
}

/** The frame-rate meter (`perf/fps.tsx`). */
function BoardSettings() {
	return (
		<SetGroup label="Boards" group="renderer">
			<SetRow title="Frame rate" sub="A meter over the canvas: frames a second, the slowest frame, and how many took over 12 ms.">
				<button class="sw-switch" type="button" role="switch" aria-label="Show the frame rate" aria-checked={showFps()} data-on={showFps()} onClick={() => chooseShowFps(!showFps())} />
			</SetRow>
		</SetGroup>
	);
}

/* ---------------------------------------------------------------------------------------- */
/* Accounts                                                                                   */

/**
 * The Claude subscriptions: each with its plan, whose it is, and how much of its 5-hour window is
 * used, as a bar. Which one answers is chosen per conversation in its model picker; this list adds
 * and removes them. The CLI's own login has no Remove: those credentials are `claude auth logout`'s.
 */
function Accounts(props: { accounts: ClaudeAccount[]; active: string; onAdd: () => void; onForget: (id: string) => void }) {
	return (
		<SetGroup label="Claude" group="accounts" foot="Each conversation picks its account in the model menu.">
			<For each={props.accounts}>{(account) => <AccountRow account={account} next={props.active === account.id && account.signedIn} onForget={() => props.onForget(account.id)} />}</For>
			<button class="sw-add" type="button" onClick={props.onAdd}>
				<Icon of={Plus} size={15} />
				Add an account
			</button>
		</SetGroup>
	);
}

function AccountRow(props: { account: ClaudeAccount; next: boolean; onForget: () => void }) {
	const name = () => props.account.email ?? (props.account.isDefault ? "Claude Code's own login" : "An account with no name yet");
	const who = () => [props.account.isDefault && props.account.email ? "Claude Code's own login" : undefined, props.account.orgName].filter(Boolean).join(" · ");
	const used = () => props.account.fiveHour && Math.min(100, props.account.fiveHour.percent);
	const level = () => (used() === undefined ? undefined : used()! >= 100 ? "high" : usageLevel(used()!));
	return (
		<SetRow
			lead={<span class="sw-face">{name().slice(0, 1).toUpperCase()}</span>}
			title={
				<span class="sw-account" data-out={!props.account.signedIn || undefined}>
					<span class="truncate">{name()}</span>
					<Show when={props.account.plan}>{(plan) => <span class="sw-plan">{plan()}</span>}</Show>
				</span>
			}
			sub={
				<>
					<Show when={who()}>
						<span class="sw-who">{who()}</span>
					</Show>
					<Show when={props.account.signedIn && used() !== undefined}>
						<span class="sw-usage" data-level={level()}>
							<i style={{ width: `${used()}%` }} />
						</span>
					</Show>
				</>
			}
		>
			<Switch>
				<Match when={!props.account.signedIn}>
					<span class="sw-state">Signed out</span>
				</Match>
				<Match when={used() !== undefined}>
					<span class="sw-state" data-level={level()}>
						{used()}% of 5 h used
					</span>
				</Match>
				<Match when={props.next}>
					<span class="sw-state" data-tone="accent">
						Default for new
					</span>
				</Match>
			</Switch>
			<Show when={!props.account.isDefault}>
				<Btn tone="danger" title={`Forget ${name()} and remove its credentials from this machine`} onClick={props.onForget}>
					Remove
				</Btn>
			</Show>
		</SetRow>
	);
}

/* ---------------------------------------------------------------------------------------- */
/* Voice                                                                                      */

/** The composer's mic (`chat/composer/voice.ts`): the recogniser, the server's model, the browser's language. */
function VoiceSettings() {
	const model = () => state.settings.sttModel ?? STT_MODELS[0]!.id;
	return (
		<>
			<SetGroup label="Voice" group="voice" foot="The mic in the composer, or Ctrl+M. Nothing is sent until you send it.">
				<SetRow title="Recogniser" sub={RECOGNISERS.find((one) => one.id === recogniser())?.note}>
					<SetSegments label="Recogniser" options={RECOGNISERS} value={recogniser()} onPick={setRecogniser} />
				</SetRow>
				<Show when={recogniser() !== "browser"}>
					<SetRow title="The server's model" sub={state.sttKey ? STT_MODELS.find((one) => one.id === model())?.note : "No key yet: set OPENAI_API_KEY on the server."}>
						<SetSelect label="The server's speech model" options={STT_MODELS} value={model()} onPick={(id) => send({ type: "settings.set", sttModel: id === STT_MODELS[0]!.id ? null : id })} />
					</SetRow>
				</Show>
				<Show when={recogniser() !== "server"}>
					<SetRow title="Language" sub="What the browser's recogniser listens for.">
						<SetSelect label="The browser's speech language" options={VOICE_LANGS} value={voiceLang()} onPick={setVoiceLang} />
					</SetRow>
				</Show>
			</SetGroup>
		</>
	);
}

/* ---------------------------------------------------------------------------------------- */
/* Connections                                                                                */

/** How long ago, in the row's words. */
const ago = (at: number) => {
	const minutes = Math.round((Date.now() - at) / 60_000);
	if (minutes < 2) return "just now";
	if (minutes < 120) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};

/** The paired front ends, one row per name and site: 44 sessions from one Studio are one row. */
export function foldPaired(rows: PairedRow[]): { label: string; origin: string; ids: string[]; last: number }[] {
	const out = new Map<string, { label: string; origin: string; ids: string[]; last: number }>();
	for (const row of rows) {
		const key = `${row.label}\u0000${row.origin}`;
		const one = out.get(key) ?? { label: row.label, origin: row.origin, ids: [], last: 0 };
		one.ids.push(row.id);
		one.last = Math.max(one.last, row.last ?? row.at);
		out.set(key, one);
	}
	return [...out.values()].sort((a, b) => b.last - a.last);
}

/**
 * Who reaches this deck: its own address, Decks Studio when it is paired (Unpair deletes its key and
 * takes back every token given through it), and every other Decks signed in with a token. A code is
 * never made here (`decks pair code`, on this machine). Revoke takes every token of the row back.
 */
function Connections() {
	const { copied, copy } = useCopy();
	return (
		<>
			<SetGroup label="This deck" group="this-deck">
				<SetRow title="Address" sub={<span class="sw-mono">{location.origin}</span>}>
					<Btn onClick={() => void copy("address", location.origin)}>{copied() === "address" ? "Copied" : "Copy"}</Btn>
				</SetRow>
				<SetRow
					title="Pairing code"
					sub={
						<>
							Made only on this machine: run <span class="sw-mono">decks pair code</span> there.
						</>
					}
				/>
			</SetGroup>
			<Show when={can("share") && pairing().studio}>
				{(studio) => (
					<SetGroup label="Decks Studio" group="studio">
						<SetRow
							lead={
								<span class="sw-mark">
									<Icon of={Cloud} size={14} />
								</span>
							}
							title="Paired with Decks Studio"
							sub={<span class="truncate">{`${studio().url} · its browsers are given an hour's token at a time through its key`}</span>}
						>
							<Show when={!studio().env}>
								<Btn tone="danger" title="Delete Studio's key: the deck stops syncing, and every browser signed in to Studio loses its way here" onClick={() => send({ type: "studio.unpair" })}>
									Unpair
								</Btn>
							</Show>
						</SetRow>
					</SetGroup>
				)}
			</Show>
			<Show when={can("share")}>
				<SetGroup label="Signed in here" group="other-decks">
					<For each={foldPaired(pairing().paired)} fallback={<SetRow title="Nothing else is signed in" />}>
						{(row) => (
							<SetRow
								lead={<span class="sw-mark">{/studio/i.test(row.label) ? <Icon of={Cloud} size={14} /> : <Icon of={Globe} size={14} />}</span>}
								title={
									<span class="truncate">
										{row.label}
										{row.ids.length > 1 ? ` · ${row.ids.length} sessions` : ""}
									</span>
								}
								sub={<span class="truncate">{`${row.origin || "unknown site"} · used ${ago(row.last)}`}</span>}
							>
								<Btn tone="danger" title="It will have to pair again with a new code" onClick={() => row.ids.forEach((id) => send({ type: "pair.revoke", id }))}>
									{row.ids.length > 1 ? "Revoke all" : "Revoke"}
								</Btn>
							</SetRow>
						)}
					</For>
				</SetGroup>
			</Show>
		</>
	);
}

/* ---------------------------------------------------------------------------------------- */
/* Chrome                                                                                     */

/**
 * The shared Chrome: whether the extension is paired and what it shares, then what to paste into
 * it. The address is `location.origin`: the server sees loopback behind a proxy, and the address
 * this page was loaded from is the one certainly right.
 */
function YourChrome(props: { web?: { status: WebStatus; code?: string }; onRepair: () => void; onStop: () => void }) {
	const { copied, copy } = useCopy();
	const status = () => props.web?.status;
	const note = () => {
		const now = status();
		if (!now) return "Waiting for the server.";
		if (now.connected) return `Sharing ${now.tabs.length === 1 ? "one tab" : `${now.tabs.length} tabs`}. Submitting asks you first.`;
		if (now.paired) return "Paired. Press the Decks button on a tab to share it.";
		return "Not paired. Paste the address and code below into the extension.";
	};
	return (
		<>
			<SetGroup label="Your Chrome" group="web">
				<SetRow
					title="The Decks extension"
					sub={
						<span class="sw-status" data-on={status()?.paired || status()?.connected || undefined}>
							<i />
							{note()}
						</span>
					}
				>
					<Show when={status()?.connected}>
						<Btn onClick={props.onStop}>Stop sharing</Btn>
					</Show>
				</SetRow>
				<For each={status()?.tabs ?? []}>{(tab) => <SetRow title={<span class="truncate">{tab.title || "(untitled)"}</span>} sub={<span class="sw-mono truncate">{tab.url}</span>} />}</For>
			</SetGroup>
			<SetGroup label="To pair a Chrome" group="pair-chrome">
				<SetRow title="Decks address" sub={<span class="sw-mono">{location.origin}</span>}>
					<Btn onClick={() => void copy("address", location.origin)}>{copied() === "address" ? "Copied" : "Copy"}</Btn>
				</SetRow>
				<SetRow title="Pairing code" sub={<span class="sw-mono">{props.web?.code ?? "…"}</span>}>
					<Btn disabled={!props.web?.code} onClick={() => props.web?.code && void copy("code", props.web.code)}>
						{copied() === "code" ? "Copied" : "Copy"}
					</Btn>
					<Btn title="Mint a fresh code; the extension has to be paired again" onClick={props.onRepair}>
						New code
					</Btn>
				</SetRow>
			</SetGroup>
		</>
	);
}
