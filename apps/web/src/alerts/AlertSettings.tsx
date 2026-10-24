import BellOff from "lucide-solid/icons/bell-off";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { createSignal, For, Show } from "solid-js";
import { Icon } from "../ui/icons.tsx";
import { Popover } from "../ui/Popover.tsx";
import { SetGroup, SetRow, SetSegments } from "../settings/rows.tsx";
import { ALERT_KINDS, ALERT_LABELS, type AlertKind, type AlertPrefs } from "./policy.ts";
import { availability, request, type Availability } from "./notify.ts";
import { play, SILENT, SOUND_FAMILIES, soundName, type SoundChoice } from "./sound.ts";

/**
 * Notifications, as the "Settings redesign" draws it: one table of the three moments, each with
 * its sound and its banner side by side under two headings, then Volume, then a line when the
 * browser will not show banners at all.
 *
 * The two groups this replaced (Sounds, then Desktop banners) printed every moment twice. A
 * moment is one thing with two answers, so it is one row; the headings say what the two
 * controls are once, and on a phone, where the columns would eat the sentence, each moment's
 * sound and switch sit under its name with the switch labelled.
 *
 * **Volume** is four named stops rather than a slider; `Off` silences all three without
 * forgetting which cue each had. **Everything previews**: picking a cue plays it, and so does
 * changing the volume, because with forty-five cues named `nope-07` listening is the only way
 * anyone could choose.
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
			{/* One table: each moment once, its sound and its banner side by side under their two headings.
			    On a phone the heads go and each moment's sound and switch sit under its name. */}
			<section class="sw-group sw-moments" data-group="notifications">
				<div class="sw-cols sw-cols-head" aria-hidden="true">
					<span>When</span>
					<span>Sound</span>
					<span>Banner</span>
				</div>
				<div class="sw-rows">
					<For each={ALERT_KINDS}>
						{(kind) => (
							<div class="sw-cols sw-moment">
								<span class="sw-name" title={ALERT_LABELS[kind].note}>
									{ALERT_LABELS[kind].label}
								</span>
								<SoundPicker id={props.prefs.sound[kind]} label={ALERT_LABELS[kind].label} onPick={(next) => setSound(kind, next)} />
								<span class="sw-banner">
									<span class="sw-banner-word">Banner</span>
									<button
										class="sw-switch"
										type="button"
										role="switch"
										aria-checked={props.prefs.notify[kind]}
										aria-label={`Show a banner when ${ALERT_LABELS[kind].label.toLowerCase()}`}
										data-on={props.prefs.notify[kind]}
										/* Dim when the browser will refuse it anyway, but still pressable, so the
										   setting survives moving to an origin where it works. */
										data-moot={permission() !== "ready" || undefined}
										onClick={() => setNotify(kind, !props.prefs.notify[kind])}
									/>
								</span>
							</div>
						)}
					</For>
				</div>
			</section>

			<SetGroup group="volume">
				<SetRow title="Volume" sub={props.prefs.volume === 0 ? "Off silences all three and keeps the choices." : undefined}>
					<SetSegments label="Volume" options={VOLUMES.map((stop) => ({ id: stop.value, label: stop.label }))} value={props.prefs.volume} onPick={setVolume} />
				</SetRow>
			</SetGroup>

			<PermissionLine state={permission()} onAsk={() => void request().then(setPermission)} />
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
			placement="bottom-start"
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
				<button class="sw-sel" type="button" ref={api.ref} aria-expanded={api.open} onClick={api.toggle}>
					<span class="truncate">{soundName(props.id)}</span>
					<Icon of={ChevronDown} size={14} />
				</button>
			)}
		>
			<button type="button" data-row data-flat="true" data-current={props.id === SILENT} onClick={() => props.onPick(SILENT)}>
				<span class="row-label">Silent</span>
			</button>
			<For each={SOUND_FAMILIES}>
				{(family) => (
					<>
						<span class="group-label">{family.label}</span>
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
 * carry out. See `alerts/notify.ts`.
 *
 * Nothing is drawn when everything is fine. A permanent line saying "banners are allowed" is
 * a row that has to be read once and then skipped forever, in a group whose three switches
 * already say the same thing by being on.
 */
function PermissionLine(props: { state: Availability; onAsk: () => void }) {
	return (
		<Show when={props.state !== "ready"}>
			<div class="sw-strip" data-tone={props.state === "ask" ? "ask" : "warn"}>
				<Icon of={BellOff} size={14} />
				<Show when={props.state === "ask"}>
					<span class="flex-1">The browser has not been asked for permission yet.</span>
					<button class="sw-btn" type="button" onClick={props.onAsk}>
						Allow
					</button>
				</Show>
				<Show when={props.state === "denied"}>
					<span class="flex-1">This browser blocks banners for this site; turn them on in its site settings.</span>
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
