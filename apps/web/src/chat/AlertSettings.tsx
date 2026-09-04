import Bell from "lucide-solid/icons/bell";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { createSignal, For, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { Popover } from "../ui/Popover.tsx";
import { ALERT_KINDS, ALERT_LABELS, type AlertKind, type AlertPrefs } from "../lib/alerts.ts";
import { availability, request, type Availability } from "../lib/notify.ts";
import { CUES, play, type SoundChoice } from "../lib/sound.ts";

/**
 * The notifications half of Settings: three events, two columns, one volume.
 *
 * The shape is opencode's — a per-event choice of sound and a per-event switch for the OS
 * banner — with two departures, both because this app is not that app.
 *
 * **The two columns are labelled.** opencode's settings page has room to give each event its
 * own block with a sentence over each control; a 520px modal does not, so the header row does
 * the work once for all three. Without it a switch beside a dropdown is a switch that could
 * plausibly mean either "play this" or "show a banner", and there is no way to find out
 * except by turning it off and waiting.
 *
 * **The volume is four named stops rather than a slider.** The app has a segmented control
 * and no slider (`.seg` in `chrome.css`), and inventing one for this would be the second
 * worst thing in the modal after a native `<select>`. Four stops is also all this needs:
 * nobody tunes a notification volume, they turn it down once.
 *
 * Every change previews. A cue you cannot hear before committing to it is a cue you set once
 * and then resent.
 */

/** The stops, loudest last. `0` is a real setting: it silences all three without forgetting
 *  which cue each of them had. */
const VOLUMES: { label: string; value: number }[] = [
	{ label: "Off", value: 0 },
	{ label: "Quiet", value: 0.35 },
	{ label: "Medium", value: 0.7 },
	{ label: "Loud", value: 1 },
];

/** `none` is first, because "no sound for this one" is the choice people come here to make. */
const CHOICES: { id: SoundChoice; label: string }[] = [{ id: "none", label: "Silent" }, ...CUES.map((cue) => ({ id: cue.id as SoundChoice, label: cue.label }))];

export function AlertSettings(props: { prefs: AlertPrefs; onChange: (prefs: AlertPrefs) => void }) {
	/*
	 * The permission state, read on mount and again after asking.
	 *
	 * A signal rather than a call in the JSX: `Notification.permission` is not reactive, so a
	 * template that read it directly would keep saying "Allow notifications" after the browser
	 * had already granted it — the one moment the line has anything to report.
	 */
	const [permission, setPermission] = createSignal<Availability>(availability());

	const setSound = (kind: AlertKind, id: SoundChoice) => {
		props.onChange({ ...props.prefs, sound: { ...props.prefs.sound, [kind]: id } });
		play(id, props.prefs.volume);
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
		<section class="alerts-block">
			<div class="label px-1 pb-1.5">Notifications</div>

			<PermissionLine state={permission()} onAsk={() => void request().then(setPermission)} />

			<div class="alerts">
				{/* The header exists to say which column is which, once. */}
				<span />
				<span class="alerts-h">Sound</span>
				<span class="alerts-h">Banner</span>

				<For each={ALERT_KINDS}>
					{(kind) => (
						<>
							<span class="alerts-k">
								<span class="lb">{ALERT_LABELS[kind].label}</span>
								<span class="nt">{ALERT_LABELS[kind].note}</span>
							</span>

							<Popover
								placement="bottom-end"
								/* Near enough the chip's own 108px that the card reads as belonging to it; a
								   `bottom-end` popover wider than its trigger hangs out to the left, over the
								   sentence it is the answer to. */
								class="w-[132px]"
								label={`Sound for when ${ALERT_LABELS[kind].label.toLowerCase()}`}
								trigger={(api) => (
									<button class="chipbtn w-full justify-between" type="button" ref={api.ref} data-on={api.open || undefined} onClick={api.toggle}>
										<span class="truncate">{CHOICES.find((choice) => choice.id === props.prefs.sound[kind])?.label ?? "Silent"}</span>
										<Icon of={ChevronDown} size={12} />
									</button>
								)}
							>
								<For each={CHOICES}>
									{(choice) => (
										<button
											type="button"
											data-row
											data-flat="true"
											data-current={props.prefs.sound[kind] === choice.id}
											onClick={() => setSound(kind, choice.id)}
										>
											<span class="lb">{choice.label}</span>
										</button>
									)}
								</For>
							</Popover>

							{/*
								A switch and not a checkbox, because it takes effect the moment it moves —
								there is no Save in this modal. `.sw` was already in `dock.css`, written for a
								menu row that never used it; these three are its first callers.
							*/}
							<button
								class="sw"
								type="button"
								role="switch"
								aria-checked={props.prefs.notify[kind]}
								aria-label={`Show a banner when ${ALERT_LABELS[kind].label.toLowerCase()}`}
								data-on={props.prefs.notify[kind]}
								/* Off, visibly, when the browser will refuse it anyway — but still
								   pressable, so the setting survives moving to an origin where it works. */
								data-moot={permission() !== "ready" || undefined}
								onClick={() => setNotify(kind, !props.prefs.notify[kind])}
							>
								<i />
							</button>
						</>
					)}
				</For>

				<span class="alerts-k">
					<span class="lb">Volume</span>
					<span class="nt">Every cue, together. “Off” keeps each choice above and silences all of them.</span>
				</span>
				<span class="col-span-2">
					<span class="seg w-full">
						<For each={VOLUMES}>
							{(stop) => (
								<button type="button" data-on={props.prefs.volume === stop.value} onClick={() => setVolume(stop.value)}>
									{stop.label}
								</button>
							)}
						</For>
					</span>
				</span>
			</div>
		</section>
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
 */
function PermissionLine(props: { state: Availability; onAsk: () => void }) {
	return (
		<div class="alerts-perm">
			<Icon of={Bell} size={13} />
			<Show when={props.state === "ask"}>
				<span class="flex-1">The browser has not been asked yet.</span>
				<button class="btn" type="button" onClick={props.onAsk}>
					Allow banners
				</button>
			</Show>
			<Show when={props.state === "ready"}>
				<span class="flex-1 text-muted">Banners are allowed. You will only see one while this window is in the background.</span>
			</Show>
			<Show when={props.state === "denied"}>
				<span class="flex-1 text-warn">This browser is blocking banners for this site. Its own site settings are the only way back.</span>
			</Show>
			<Show when={props.state === "insecure"}>
				<span class="flex-1 text-warn">
					Banners need a secure page, and this one is plain <code>http</code>. Sounds work here; for banners, open the deck on <code>localhost</code> or behind
					TLS.
				</span>
			</Show>
			<Show when={props.state === "unsupported"}>
				<span class="flex-1 text-muted">This browser has no notifications. The sounds and the tab count still work.</span>
			</Show>
		</div>
	);
}
