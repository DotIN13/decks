import { chooseShowFps, showFps } from "../perf/fps.tsx";
import { STT_MODELS, type ClaudeAccount, type PairedRow, type WebStatus } from "@decks/protocol";
import { recogniser, recognisers, setRecogniser, setVoiceLang, voiceLang, voiceLangs } from "../composer/voice.ts";
import Bell from "lucide-solid/icons/bell";
import Cloud from "lucide-solid/icons/cloud";
import Globe from "lucide-solid/icons/globe";
import Mic from "lucide-solid/icons/mic";
import Plug from "lucide-solid/icons/plug";
import Plus from "lucide-solid/icons/plus";
import Puzzle from "lucide-solid/icons/puzzle";
import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import Sparkles from "lucide-solid/icons/sparkles";
import User from "lucide-solid/icons/user";
import X from "lucide-solid/icons/x";
import { createEffect, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js";
import { StudioGroup } from "./StudioSignIn.tsx";
import { SetGroup, SetRow, SetSegments, SetSelect } from "./rows.tsx";
import { browserZone, clockTime, Icon } from "@decks/ui";
import { browserLocale, chooseLocale, chosenLocale, formatAgo, formatNumber, LANGUAGES, m, type Locale } from "@decks/i18n";
import { usageLevel } from "../lib/context-usage.ts";
import { state } from "../state/deck.ts";
import { call, warnIfFailed } from "../state/socket.ts";
import { can, pairing } from "../connections/backend.ts";
import { AlertSettings } from "./AlertSettings.tsx";
import type { AlertPrefs } from "@decks/agent-ui/alerts";

/**
 * The seven sections, in the order the left of the window lists them. Accounts is the person's own
 * account, Decks Studio's; Claude is the model's subscriptions; Connections is other Decks reaching
 * this one.
 */
const SECTIONS = [
	{ id: "general", label: () => m.settings_section_general(), icon: SlidersHorizontal },
	{ id: "notifications", label: () => m.settings_section_notifications(), icon: Bell },
	{ id: "accounts", label: () => m.settings_section_accounts(), icon: User },
	{ id: "claude", label: () => "Claude", icon: Sparkles },
	{ id: "voice", label: () => m.settings_section_voice(), icon: Mic },
	{ id: "connections", label: () => m.settings_section_connections(), icon: Plug },
	{ id: "chrome", label: () => "Chrome", icon: Puzzle },
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
 * On a computer and an iPad it is a window: the seven sections on a grey left, the open one on the
 * right under its name and a ×. On a phone it is the app's bottom sheet, as the properties sheet
 * is: Settings and a blue Done, then the sections as the sidebar's tabs, scrolling sideways, over
 * the same rows. The rows are one vocabulary (`.sw-row`: words on the left, one control on the
 * right) and only the narrow width stacks a row's control under its words.
 *
 * A modal: opened, used, closed. A press that *begins* on the backdrop closes it, for the reason
 * `FilePicker` gives: the tap that opened it lands a `click` here afterwards.
 */
export function Settings(props: {
	/** What the app may interrupt you with (`settings/AlertSettings.tsx`). */
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
	// Accounts is Decks Studio's login, which a backend that cannot share has none of.
	const sections = () => SECTIONS.filter((one) => one.id !== "accounts" || can("share"));
	const [chosen, setSection] = createSignal<Section>(saved());
	const section = (): Section => (sections().some((one) => one.id === chosen()) ? chosen() : "notifications");
	const open = (id: Section) => {
		setSection(id);
		try {
			localStorage.setItem(KEY, id);
		} catch {
			/* private mode: it opens on Notifications next time */
		}
	};
	const label = () => SECTIONS.find((one) => one.id === section())!.label();

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
					<LanguageSettings />
					<TimeSettings />
					<CanvasSettings />
				</Match>
				<Match when={section() === "notifications"}>
					<AlertSettings prefs={props.prefs} onChange={props.onPrefs} />
				</Match>
				<Match when={section() === "accounts"}>
					<StudioGroup />
				</Match>
				<Match when={section() === "claude"}>
					<ClaudeAccounts accounts={props.accounts} active={props.active} onAdd={props.onAdd} onForget={props.onForget} />
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
					<div class="settings sw-win" role="dialog" aria-label={m.settings_title()}>
						<nav class="sw-nav" aria-label={m.settings_sections()}>
							<span class="sw-nav-title">{m.settings_title()}</span>
							<For each={sections()}>
								{(one) => (
									<button type="button" data-section={one.id} data-on={section() === one.id} aria-current={section() === one.id ? "page" : undefined} onClick={() => open(one.id)}>
										<Icon of={one.icon} size={15} />
										{one.label()}
									</button>
								)}
							</For>
						</nav>
						<div class="sw-pane">
							<header class="sw-head">
								<span class="sw-title">{label()}</span>
								<span class="flex-1" />
								<button class="sw-x" type="button" title={m.settings_close()} aria-label={m.settings_close()} onClick={props.onClose}>
									<Icon of={X} size={16} />
								</button>
							</header>
							{body()}
						</div>
					</div>
				}
			>
				<div class="settings sw-sheet" role="dialog" aria-label={m.settings_title()}>
					<header class="sw-head">
						<span class="sw-title">{m.settings_title()}</span>
						<span class="flex-1" />
						<button class="sw-done" type="button" onClick={props.onClose}>
							{m.settings_done()}
						</button>
					</header>
					<div class="sw-tabs" role="tablist" ref={tabs}>
						<Show when={mark()}>{(at) => <span class="sw-tab-mark" style={{ left: `${at().left}px`, width: `${at().width}px` }} />}</Show>
						<For each={sections()}>
							{(one) => (
								<button type="button" role="tab" data-section={one.id} data-on={section() === one.id} aria-selected={section() === one.id} onClick={() => open(one.id)}>
									<Icon of={one.icon} size={15} />
									{one.label()}
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
		void call("harness.configure", [{ timezone }]).then(warnIfFailed);
		setDraft("");
	};
	const inForce = () => chosen() ?? state.machineZone;
	return (
		<SetGroup label={m.settings_time()} group="time">
			<SetRow
				title={m.settings_timezone()}
				sub={
					<span data-zone-now>
						{chosen() ? m.settings_timezone_set({ zone: chosen()! }) : m.settings_timezone_unset({ zone: state.machineZone || m.settings_timezone_unknown() })} {m.settings_timezone_now({ time: clockTime(tick(), inForce() || undefined) })}
					</span>
				}
			>
				<Show when={chosen()} fallback={<Btn onClick={() => set(mine)}>{m.settings_timezone_use({ zone: mine })}</Btn>}>
					<Btn title={m.settings_timezone_back({ zone: state.machineZone })} onClick={() => set(null)}>
						{m.settings_timezone_use_server()}
					</Btn>
				</Show>
			</SetRow>
			<SetRow title={m.settings_timezone_other()} sub={m.settings_timezone_other_sub()}>
				<input
					class="sw-field"
					list="set-zones"
					placeholder="Asia/Shanghai"
					aria-label={m.settings_timezone()}
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
					{m.settings_set()}
				</Btn>
			</SetRow>
		</SetGroup>
	);
}

/**
 * The language the page speaks, kept in this browser: a person may read Chinese on one machine and
 * English on another, so it is not the deck's. "As the browser" follows the browser's languages.
 * Choosing reloads the page in the new language.
 */
function LanguageSettings() {
	const BROWSER = "browser";
	const options = () => [{ id: BROWSER, label: m.settings_language_browser({ name: LANGUAGES.find((one) => one.locale === (browserLocale() ?? "en"))!.name }) }, ...LANGUAGES.map((one) => ({ id: one.locale, label: one.name }))];
	return (
		<SetGroup label={m.settings_language()} group="language">
			<SetRow title={m.settings_language_row()} sub={m.settings_language_sub()}>
				<SetSelect options={options()} value={chosenLocale() ?? BROWSER} label={m.settings_language()} onPick={(id) => chooseLocale(id === BROWSER ? undefined : (id as Locale))} />
			</SetRow>
		</SetGroup>
	);
}

/** The frame-rate meter (`perf/fps.tsx`). */
function CanvasSettings() {
	return (
		<SetGroup label={m.settings_canvas()} group="renderer">
			<SetRow title={m.settings_fps()} sub={m.settings_fps_sub()}>
				<button class="sw-switch" type="button" role="switch" aria-label={m.settings_fps_show()} aria-checked={showFps()} data-on={showFps()} onClick={() => chooseShowFps(!showFps())} />
			</SetRow>
		</SetGroup>
	);
}

/* ---------------------------------------------------------------------------------------- */
/* Claude                                                                                     */

/**
 * The Claude subscriptions: each with its plan, whose it is, and how much of its 5-hour window is
 * used, as a bar. Which one answers is chosen per conversation in its model picker; this list adds
 * and removes them. The CLI's own login has no Remove: those credentials are `claude auth logout`'s.
 */
function ClaudeAccounts(props: { accounts: ClaudeAccount[]; active: string; onAdd: () => void; onForget: (id: string) => void }) {
	return (
		<SetGroup label={m.settings_claude_subscriptions()} group="claude" foot={m.settings_claude_foot()}>
			<For each={props.accounts}>{(account) => <AccountRow account={account} next={props.active === account.id && account.signedIn} onForget={() => props.onForget(account.id)} />}</For>
			<button class="sw-add" type="button" onClick={props.onAdd}>
				<Icon of={Plus} size={15} />
				{m.settings_claude_add()}
			</button>
		</SetGroup>
	);
}

function AccountRow(props: { account: ClaudeAccount; next: boolean; onForget: () => void }) {
	const name = () => props.account.email ?? (props.account.isDefault ? m.settings_claude_own_login() : m.settings_claude_no_name());
	const who = () => [props.account.isDefault && props.account.email ? m.settings_claude_own_login() : undefined, props.account.orgName].filter(Boolean).join(" · ");
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
					<span class="sw-state">{m.settings_claude_signed_out()}</span>
				</Match>
				<Match when={used() !== undefined}>
					<span class="sw-state" data-level={level()}>
						{m.settings_claude_used({ percent: formatNumber(used()! / 100, { style: "percent" }) })}
					</span>
				</Match>
				<Match when={props.next}>
					<span class="sw-state" data-tone="accent">
						{m.settings_claude_default()}
					</span>
				</Match>
			</Switch>
			<Show when={!props.account.isDefault}>
				<Btn tone="danger" title={m.settings_claude_remove_title({ name: name() })} onClick={props.onForget}>
					{m.settings_claude_remove()}
				</Btn>
			</Show>
		</SetRow>
	);
}

/* ---------------------------------------------------------------------------------------- */
/* Voice                                                                                      */

/** The composer's mic (`composer/voice.ts`): the recogniser, the server's model, the browser's language. */
function VoiceSettings() {
	const model = () => state.settings.sttModel ?? STT_MODELS[0]!.id;
	return (
		<>
			<SetGroup label={m.settings_section_voice()} group="voice" foot={m.settings_voice_foot()}>
				<SetRow title={m.settings_voice_recogniser()} sub={recognisers().find((one) => one.id === recogniser())?.note}>
					<SetSegments label={m.settings_voice_recogniser()} options={recognisers()} value={recogniser()} onPick={setRecogniser} />
				</SetRow>
				<Show when={recogniser() !== "browser"}>
					<SetRow title={m.settings_voice_model()} sub={state.sttKey ? sttNote(model()) : m.settings_voice_no_key()}>
						<SetSelect label={m.settings_voice_model_label()} options={STT_MODELS} value={model()} onPick={(id) => void call("harness.configure", [{ sttModel: id === STT_MODELS[0]!.id ? null : id }]).then(warnIfFailed)} />
					</SetRow>
				</Show>
				<Show when={recogniser() !== "server"}>
					<SetRow title={m.settings_language()} sub={m.settings_voice_lang_sub()}>
						<SetSelect label={m.settings_voice_lang_label()} options={voiceLangs()} value={voiceLang()} onPick={setVoiceLang} />
					</SetRow>
				</Show>
			</SetGroup>
		</>
	);
}

/* ---------------------------------------------------------------------------------------- */
/* Connections                                                                                */

/** What the server's speech model is like, from its id (`STT_MODELS` in `@decks/protocol`), in the language shown. */
const sttNote = (id: string): string | undefined =>
	(
		({
			"gpt-4o-mini-transcribe": () => m.settings_voice_stt_mini(),
			"gpt-transcribe": () => m.settings_voice_stt_gpt(),
			"gpt-4o-transcribe": () => m.settings_voice_stt_4o(),
			"whisper-1": () => m.settings_voice_stt_whisper(),
		}) as Record<string, () => string>
	)[id]?.() ?? STT_MODELS.find((one) => one.id === id)?.note;

/** The paired front ends, one row per name and site: 44 sessions from one Studio are one row. */
function foldPaired(rows: PairedRow[]): { label: string; origin: string; ids: string[]; last: number }[] {
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
 * Decks connection: what another Decks, the iPad app or a terminal connects to this one with, its
 * address and a pairing code, and who is connected; Revoke takes every token of a row back. A code
 * is never made here (`decks pair code`, on this machine). Decks Studio is not here: this harness
 * signs in to it, which is the person's account and so is under Accounts (`StudioSignIn.tsx`), and
 * the words keep the two apart, connect for a Decks and sign in for Studio.
 */
function Connections() {
	const { copied, copy } = useCopy();
	return (
		<>
			<SetGroup label={m.settings_conn_group()} group="this-deck" foot={m.settings_conn_foot()}>
				<SetRow title={m.settings_conn_address()} sub={<span class="sw-mono">{location.origin}</span>}>
					<Btn onClick={() => void copy("address", location.origin)}>{copied() === "address" ? m.settings_copied() : m.settings_copy()}</Btn>
				</SetRow>
				<SetRow
					title={m.settings_conn_code()}
					sub={
						<>
							{m.settings_conn_code_sub()} <span class="sw-mono">decks pair code</span>
						</>
					}
				/>
			</SetGroup>
			<Show when={can("share")}>
				<SetGroup label={m.settings_conn_connected()} group="other-decks">
					<For each={foldPaired(pairing().paired)} fallback={<SetRow title={m.settings_conn_none()} />}>
						{(row) => (
							<SetRow
								lead={<span class="sw-mark">{/studio/i.test(row.label) ? <Icon of={Cloud} size={14} /> : <Icon of={Globe} size={14} />}</span>}
								title={
									<span class="truncate">
										{row.label}
										{row.ids.length > 1 ? ` · ${m.settings_conn_sessions({ count: row.ids.length })}` : ""}
									</span>
								}
								sub={<span class="truncate">{m.settings_conn_used({ site: row.origin || m.settings_conn_unknown_site(), ago: formatAgo(row.last) })}</span>}
							>
								<Btn tone="danger" title={m.settings_conn_revoke_title()} onClick={() => row.ids.forEach((id) => void call("harness.revoke", [id]))}>
									{row.ids.length > 1 ? m.settings_conn_revoke_all() : m.settings_conn_revoke()}
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
		if (!now) return m.settings_chrome_waiting();
		if (now.connected) return m.settings_chrome_sharing({ count: now.tabs.length });
		if (now.paired) return m.settings_chrome_paired();
		return m.settings_chrome_not_paired();
	};
	return (
		<>
			<SetGroup label={m.settings_chrome_yours()} group="web">
				<SetRow
					title={m.settings_chrome_extension()}
					sub={
						<span class="sw-status" data-on={status()?.paired || status()?.connected || undefined}>
							<i />
							{note()}
						</span>
					}
				>
					<Show when={status()?.connected}>
						<Btn onClick={props.onStop}>{m.settings_chrome_stop()}</Btn>
					</Show>
				</SetRow>
				<For each={status()?.tabs ?? []}>{(tab) => <SetRow title={<span class="truncate">{tab.title || m.settings_chrome_untitled()}</span>} sub={<span class="sw-mono truncate">{tab.url}</span>} />}</For>
			</SetGroup>
			<SetGroup label={m.settings_chrome_to_pair()} group="pair-chrome">
				<SetRow title={m.settings_chrome_address()} sub={<span class="sw-mono">{location.origin}</span>}>
					<Btn onClick={() => void copy("address", location.origin)}>{copied() === "address" ? m.settings_copied() : m.settings_copy()}</Btn>
				</SetRow>
				<SetRow title={m.settings_conn_code()} sub={<span class="sw-mono">{props.web?.code ?? "…"}</span>}>
					<Btn disabled={!props.web?.code} onClick={() => props.web?.code && void copy("code", props.web.code)}>
						{copied() === "code" ? m.settings_copied() : m.settings_copy()}
					</Btn>
					<Btn title={m.settings_chrome_new_code_title()} onClick={props.onRepair}>
						{m.settings_chrome_new_code()}
					</Btn>
				</SetRow>
			</SetGroup>
		</>
	);
}
