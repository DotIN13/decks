import { chooseShowFps, showFps } from "../../perf/fps.tsx";
import { STT_MODELS, type ClaudeAccount, type WebStatus } from "../../state/types/index.ts";
import { RECOGNISERS, recogniser, setRecogniser, setVoiceLang, VOICE_LANGS, voiceLang } from "../../composer/index.ts";
import Cloud from "lucide-solid/icons/cloud";
import Globe from "lucide-solid/icons/globe";
import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import { createEffect, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js";
import { SetGroup, SetRow, SetSegments, SetSelect } from "../rows.tsx";
import { browserZone, clockTime, Icon } from "@decks/ui";
import { usageLevel } from "../../lib/context-usage.ts";
import { state } from "../../state/deck.ts";
import { can, pairing } from "../../connections/backend.ts";
import { revokeAll, setSttModel, setTimezone, unpairStudio, useCopy } from "./actions.ts";
import { ago, foldPaired } from "./model.ts";

// The sections of Settings, each a group of rows: time and the canvas, accounts,
// voice, who reaches this deck, and the shared Chrome tab.
/** A plain button in a row. */
function Btn(props: { children: JSX.Element; onClick: () => void; tone?: "danger"; title?: string; disabled?: boolean }) {
	return (
		<button class="sw-btn" type="button" data-tone={props.tone} title={props.title} disabled={props.disabled} onClick={props.onClick}>
			{props.children}
		</button>
	);
}

/** Copy some words, and say so on the button for a moment. */


/* ---------------------------------------------------------------------------------------- */
/* General                                                                                    */

/**
 * The deck's timezone: one zone for the whole deck, kept by the server, so schedules fire in it
 * with no browser open. Nothing is guessed: until one is chosen the server is on its machine's
 * clock, and the row says so with one button to take this browser's zone.
 */
export function TimeSettings() {
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
		setTimezone(timezone);
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
export function CanvasSettings() {
	return (
		<SetGroup label="Canvas" group="renderer">
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
export function Accounts(props: { accounts: ClaudeAccount[]; active: string; onAdd: () => void; onForget: (id: string) => void }) {
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

/** The composer's mic (`composer/voice.ts`): the recogniser, the server's model, the browser's language. */
export function VoiceSettings() {
	const model = () => state.settings.sttModel ?? STT_MODELS[0]!.id;
	return (
		<>
			<SetGroup label="Voice" group="voice" foot="The mic in the composer, or Ctrl+M. Nothing is sent until you send it.">
				<SetRow title="Recogniser" sub={RECOGNISERS.find((one) => one.id === recogniser())?.note}>
					<SetSegments label="Recogniser" options={RECOGNISERS} value={recogniser()} onPick={setRecogniser} />
				</SetRow>
				<Show when={recogniser() !== "browser"}>
					<SetRow title="The server's model" sub={state.sttKey ? STT_MODELS.find((one) => one.id === model())?.note : "No key yet: set OPENAI_API_KEY on the server."}>
						<SetSelect label="The server's speech model" options={STT_MODELS} value={model()} onPick={(id) => setSttModel(id === STT_MODELS[0]!.id ? null : id)} />
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



/**
 * Who reaches this deck: its own address, Decks Studio when it is paired (Unpair deletes its key and
 * takes back every token given through it), and every other Decks signed in with a token. A code is
 * never made here (`decks pair code`, on this machine). Revoke takes every token of the row back.
 */
export function Connections() {
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
								<Btn tone="danger" title="Delete Studio's key: the deck stops syncing, and every browser signed in to Studio loses its way here" onClick={() => unpairStudio()}>
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
								<Btn tone="danger" title="It will have to pair again with a new code" onClick={() => revokeAll(row.ids)}>
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
export function YourChrome(props: { web?: { status: WebStatus; code?: string }; onRepair: () => void; onStop: () => void }) {
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
