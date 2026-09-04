import Bell from "lucide-solid/icons/bell";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { createSignal, For, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { Popover } from "../ui/Popover.tsx";
import { ALERT_KINDS, ALERT_LABELS, type AlertKind, type AlertPrefs } from "../lib/alerts.ts";
import { availability, request, type Availability } from "../lib/notify.ts";
import { play, SILENT, SOUND_FAMILIES, soundName, type SoundChoice } from "../lib/sound.ts";

/**
 * Notifications, as two groups of rows.
 *
 * ### What this replaced, and why it had to go
 *
 * The first version was a three-column grid — the event on the left, a sound picker and a
 * banner switch on the right, with a header row naming the two columns. It measured correctly
 * and it read like a spreadsheet, and the header was load-bearing in a way that should have
 * been the warning: a control that needs a column heading to say what it does is a control in
 * the wrong place. Widen the modal and the heading drifts from the switch; put it on a phone
 * and the two columns eat the sentence.
 *
 * So the axis is flipped. **One group per thing the app can do** — play a sound, raise a
 * banner — and inside each, one row per event with exactly one control on it. No heading is
 * needed to say what a switch means when every switch in the group means the same thing, and
 * the group says it once in its own title.
 *
 * The cost is the three event names appearing twice. That is the trade every grouped settings
 * screen makes, and it buys the thing that matters here: a row you can read left to right and
 * be finished. The sentences are printed once, in Sounds, because they describe the *event*
 * rather than the sound — repeating them under Banners would be the spreadsheet again with
 * extra words.
 *
 * ### The rest of it
 *
 * **Volume is the last row of Sounds**, four named stops rather than a slider: this app has a
 * segmented control and no slider, and nobody tunes a notification volume — they turn it down
 * once. `Off` silences all three without forgetting which cue each of them had.
 *
 * **Everything previews.** Picking a cue plays it; so does changing the volume. A sound you
 * cannot hear before committing to it is a sound you set once and then resent — and with
 * forty-five of them, all named things like `nope-07`, the preview is the only way anyone
 * could possibly choose.
 */

/** The stops, loudest last. Linear on `audio.volume`, which is what an `<audio>` element takes. */
const VOLUMES: { label: string; value: number }[] = [
	{ label: "Off", value: 0 },
	{ label: "Quiet", value: 0.3 },
	{ label: "Medium", value: 0.65 },
	{ label: "Loud", value: 1 },
];

export function AlertSettings(props: { prefs: AlertPrefs; onChange: (prefs: AlertPrefs) => void }) {
	/*
	 * The permission state, read on mount and again after asking.
	 *
	 * A signal rather than a call in the JSX: `Notification.permission` is not reactive, so a
	 * template that read it directly would keep saying "the browser has not been asked" after
	 * the browser had already granted it — the one moment the line has anything to report.
	 */
	const [permission, setPermission] = createSignal<Availability>(availability());

	const setSound = (kind: AlertKind, id: SoundChoice) => {
		props.onChange({ ...props.prefs, sound: { ...props.prefs.sound, [kind]: id } });
		play(id, props.prefs.volume || VOLUMES[2]!.value);
	};
	const setNotify = (kind: AlertKind, on: boolean) => {
		props.onChange({ ...props.prefs, notify: { ...props.prefs.notify, [kind]: on } });
		// Turning one on when the browser has not been asked is the natural moment to ask, and
		// it is a click, which is the gesture `request` needs.
		if (on && permission() === "ask") void request().then(setPermission);
	};
	const setVolume = (value: number) => {
		props.onChange({ ...props.prefs, volume: value });
		// At the new level, not the old one — the point of pressing "Quiet" is to hear quiet.
		if (value > 0) play(props.prefs.sound.done, value);
	};

	return (
		<>
			<section class="set-group" data-group="sounds">
				<header>
					<span class="set-title">Sounds</span>
					<span class="set-note">Played whether or not you are looking at this window.</span>
				</header>

				<For each={ALERT_KINDS}>
					{(kind) => (
						<div class="set-row">
							<span class="set-k">
								<span class="lb">{ALERT_LABELS[kind].label}</span>
								<span class="nt">{ALERT_LABELS[kind].note}</span>
							</span>
							<SoundPicker id={props.prefs.sound[kind]} label={ALERT_LABELS[kind].label} onPick={(next) => setSound(kind, next)} />
						</div>
					)}
				</For>

				<div class="set-row">
					<span class="set-k">
						<span class="lb">Volume</span>
						<span class="nt">All three together. “Off” keeps each choice above and silences them.</span>
					</span>
					<span class="seg set-vol">
						<For each={VOLUMES}>
							{(stop) => (
								<button type="button" data-on={props.prefs.volume === stop.value} onClick={() => setVolume(stop.value)}>
									{stop.label}
								</button>
							)}
						</For>
					</span>
				</div>
			</section>

			<section class="set-group" data-group="banners">
				<header>
					<span class="set-title">Desktop banners</span>
					<span class="set-note">Only when this window is in the background.</span>
				</header>

				<PermissionLine state={permission()} onAsk={() => void request().then(setPermission)} />

				<For each={ALERT_KINDS}>
					{(kind) => (
						<div class="set-row">
							{/* The sentence is in Sounds and not repeated here: it describes the event, and
							    the event is the same one. */}
							<span class="set-k">
								<span class="lb">{ALERT_LABELS[kind].label}</span>
							</span>
							<button
								class="sw"
								type="button"
								role="switch"
								aria-checked={props.prefs.notify[kind]}
								aria-label={`Show a banner when ${ALERT_LABELS[kind].label.toLowerCase()}`}
								data-on={props.prefs.notify[kind]}
								/* Off, visibly, when the browser will refuse it anyway — but still pressable,
								   so the setting survives moving to an origin where it works. */
								data-moot={permission() !== "ready" || undefined}
								onClick={() => setNotify(kind, !props.prefs.notify[kind])}
							>
								<i />
							</button>
						</div>
					)}
				</For>
			</section>
		</>
	);
}

/**
 * Forty-five cues, grouped by family, previewed on press.
 *
 * The families are opencode's and their names say nothing — `nope-03` against `nope-07` is not
 * a choice anybody can make by reading. So the list is grouped so the eye can skip a family
 * whole, the rows are the number alone because the heading above them has already said the
 * rest, and **pressing one plays it and leaves the menu open**, which turns picking a
 * notification sound from a guess into listening to four and keeping one.
 */
function SoundPicker(props: { id: SoundChoice; label: string; onPick: (id: SoundChoice) => void }) {
	return (
		<Popover
			placement="bottom-end"
			class="set-sounds"
			label={`Sound for when ${props.label.toLowerCase()}`}
			/*
			 * Nothing is preloaded on open, deliberately.
			 *
			 * The first draft warmed all forty-five so the first press would be instant — 356kB
			 * fetched because somebody opened a menu, to save a round trip on an 8kB file. The
			 * browser fetches the one that is pressed, and `App.tsx` warms the three that are
			 * *configured* on the first gesture, which is the case that actually matters: a cue
			 * arriving late is only a problem when it is announcing something.
			 */
			trigger={(api) => (
				<button class="chipbtn set-cue" type="button" ref={api.ref} data-on={api.open || undefined} onClick={api.toggle}>
					<span class="truncate">{soundName(props.id)}</span>
					<Icon of={ChevronDown} size={12} />
				</button>
			)}
		>
			<button type="button" data-row data-flat="true" data-current={props.id === SILENT} onClick={() => props.onPick(SILENT)}>
				<span class="lb">Silent</span>
			</button>
			<For each={SOUND_FAMILIES}>
				{(family) => (
					<>
						<span class="grp">{family.label}</span>
						<div class="set-cues">
							<For each={Array.from({ length: family.count }, (_, index) => `${family.id}-${String(index + 1).padStart(2, "0")}`)}>
								{(id) => (
									<button
										type="button"
										class="set-cue-n"
										data-row
										/*
										 * The menu stays open when a number is pressed — `Popover`'s own
										 * `data-keep-open`, which the zoom steppers established for the same
										 * reason: pressing one is not finishing, it is trying one. Escape or a
										 * press outside closes it. "Silent" above has no such attribute, because
										 * choosing silence *is* a decision.
										 */
										data-keep-open
										data-current={props.id === id}
										title={id}
										onClick={() => props.onPick(id)}
									>
										{id.slice(-2)}
									</button>
								)}
							</For>
						</div>
					</>
				)}
			</For>
		</Popover>
	);
}

/**
 * One line about whether a banner can appear at all — and it is not always "ask".
 *
 * The case that matters here is `insecure`. This deck is routinely opened at
 * `http://10.0.0.249:4327` from a phone, and on a plain-HTTP origin the browser refuses
 * notifications outright. Saying "allow notifications" there would be a button that does
 * nothing, so the state is named and the fix is given, because it is a real fix somebody can
 * carry out. See `lib/notify.ts`.
 *
 * Nothing is drawn when everything is fine. A permanent line saying "banners are allowed" is
 * a row that has to be read once and then skipped forever, in a group whose three switches
 * already say the same thing by being on.
 */
function PermissionLine(props: { state: Availability; onAsk: () => void }) {
	return (
		<Show when={props.state !== "ready"}>
			<div class="set-strip" data-tone={props.state === "ask" ? "ask" : "warn"}>
				<Icon of={Bell} size={13} />
				<Show when={props.state === "ask"}>
					<span class="flex-1">The browser has not been asked for permission yet.</span>
					<button class="btn" type="button" onClick={props.onAsk}>
						Allow
					</button>
				</Show>
				<Show when={props.state === "denied"}>
					<span class="flex-1">This browser is blocking banners for this site. Its own site settings are the only way back.</span>
				</Show>
				<Show when={props.state === "insecure"}>
					<span class="flex-1">
						Banners need a secure page and this one is plain <code>http</code>. Sounds work here; for banners, open the deck on <code>localhost</code> or behind TLS.
					</span>
				</Show>
				<Show when={props.state === "unsupported"}>
					<span class="flex-1">This browser has no notifications. The sounds and the tab count still work.</span>
				</Show>
			</div>
		</Show>
	);
}
