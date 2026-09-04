/**
 * The app's cues, synthesised rather than sampled.
 *
 * opencode ships forty-five `.mp3`/`.aac` pairs in `packages/ui/src/assets/audio` and picks
 * one per event; this does the same job with a table of notes and an oscillator, for three
 * reasons worth writing down because the obvious move was to copy the files.
 *
 * 1. **A cue is four numbers.** Every sound here is two or three notes with a bell envelope.
 *    Shipping that as compressed audio is ninety files and a decode step to say what fits in
 *    a line of TypeScript, and the line is the thing you can actually read and change.
 * 2. **It is a rounding error in the bundle.** The mp3 set is about a megabyte; this module
 *    is under 4kB and needs no `import.meta.glob`, no lazy loader and no cache keyed on a
 *    filename.
 * 3. **The licence.** opencode is MIT, so copying is permitted with the notice attached —
 *    but the notice would have to travel with audio whose *own* provenance the repository
 *    does not state. Writing the cues avoids inheriting a question nobody can answer.
 *
 * What is deliberately kept from opencode's design is the shape around the sound: a named
 * set the user picks from per event, an explicit silent option, and a preview that plays the
 * moment you choose one (`chat/Settings.tsx`). A cue you cannot hear before committing to it
 * is a cue you set once and then resent.
 *
 * The pure half — the note tables, the tuning, the envelope arithmetic — is here and tested
 * in `sound.test.ts`. The `AudioContext` half is at the bottom and is not: a test that
 * asserts a browser made a noise is a test of the browser.
 */

/** A note in a cue: when it starts, what pitch, how long, and how loud against the others. */
export interface Note {
	/** Milliseconds after the cue begins. */
	at: number;
	/** Scientific pitch notation — `"G5"`, `"C#6"`, `"Eb4"`. Resolved by `hz`. */
	pitch: string;
	/** How long the tail is allowed to ring, in milliseconds. */
	ms: number;
	/** Relative to the cue, 0–1. The master volume is applied on top. */
	gain: number;
}

export interface Cue {
	id: CueId;
	/** What it is called in the picker. One word where possible. */
	label: string;
	notes: Note[];
}

/**
 * The names, in the order the picker lists them: quiet first, urgent last.
 *
 * Seven and not forty-five. The choice exists so somebody who cannot stand one of these can
 * use another, not so that picking a notification sound becomes an afternoon — and a list
 * long enough to scroll is a list where the difference between `bip-bop-04` and `bip-bop-07`
 * has to be discovered one press at a time.
 */
export const CUE_IDS = ["tick", "bloop", "chime", "ping", "knock", "drop", "alarm"] as const;
export type CueId = (typeof CUE_IDS)[number];

/** `"none"` is a real choice rather than the absence of one — see `SoundChoice`. */
export type SoundChoice = CueId | "none";

/**
 * Equal temperament, A4 = 440Hz.
 *
 * Named pitches rather than raw frequencies because the intervals are the whole design: a
 * cue says something by *rising* or *falling*, and `G5 → D6` states the fifth where `784 →
 * 1175` states two numbers somebody has to divide. Tested against the values a piano tuner
 * would give.
 */
const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function hz(pitch: string): number {
	const parsed = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch);
	if (!parsed) throw new Error(`not a pitch: ${pitch}`);
	const [, letter, accidental, octave] = parsed;
	// The regex has already restricted the letter to A–G, so the lookup cannot miss; `?? 0`
	// is there for the type checker rather than for a case that can happen.
	const step = (SEMITONES[letter as string] ?? 0) + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
	// MIDI numbering, where A4 is 69 and each octave starts at C.
	const midi = (Number(octave) + 1) * 12 + step;
	return 440 * 2 ** ((midi - 69) / 12);
}

/*
 * The cues themselves.
 *
 * Three shapes and they map onto the three things the app has to say. **Rising** is finished
 * — the phrase resolves upward and stops asking. **Level** is a question: two notes at the
 * same pitch have nowhere to go, which is what makes a knock feel like it is waiting for an
 * answer. **Falling** is wrong, and the two error cues fall by a tritone and a minor third
 * respectively, the intervals a doorbell is careful never to use.
 *
 * Every one of them is under 400ms. A notification sound is heard several hundred times a
 * day by somebody who leaves this open, and the ones that survive that are short.
 */
export const CUES: Cue[] = [
	{
		id: "tick",
		label: "Tick",
		notes: [{ at: 0, pitch: "D6", ms: 90, gain: 0.5 }],
	},
	{
		id: "bloop",
		label: "Bloop",
		notes: [
			{ at: 0, pitch: "C5", ms: 130, gain: 0.7 },
			{ at: 70, pitch: "G5", ms: 200, gain: 0.6 },
		],
	},
	{
		id: "chime",
		label: "Chime",
		notes: [
			{ at: 0, pitch: "G5", ms: 180, gain: 0.65 },
			{ at: 90, pitch: "D6", ms: 300, gain: 0.55 },
		],
	},
	{
		id: "ping",
		label: "Ping",
		notes: [{ at: 0, pitch: "A6", ms: 280, gain: 0.42 }],
	},
	{
		id: "knock",
		label: "Knock",
		notes: [
			{ at: 0, pitch: "F5", ms: 120, gain: 0.62 },
			{ at: 130, pitch: "F5", ms: 200, gain: 0.62 },
		],
	},
	{
		id: "drop",
		label: "Drop",
		notes: [
			{ at: 0, pitch: "F5", ms: 150, gain: 0.6 },
			{ at: 100, pitch: "B4", ms: 300, gain: 0.62 },
		],
	},
	{
		id: "alarm",
		label: "Alarm",
		notes: [
			{ at: 0, pitch: "E5", ms: 110, gain: 0.6 },
			{ at: 110, pitch: "C5", ms: 110, gain: 0.6 },
			{ at: 220, pitch: "A4", ms: 170, gain: 0.65 },
		],
	},
];

const BY_ID = new Map(CUES.map((cue) => [cue.id, cue]));

export function cue(id: SoundChoice | undefined): Cue | undefined {
	if (!id || id === "none") return undefined;
	return BY_ID.get(id);
}

/** How long a cue rings for, start to last tail. Used by the preview and by the tests. */
export function cueLength(id: SoundChoice | undefined): number {
	const found = cue(id);
	if (!found) return 0;
	return Math.max(...found.notes.map((note) => note.at + note.ms));
}

/**
 * The partials each note is built from: the fundamental, the octave, and the twelfth.
 *
 * A bare sine is a test tone and a bare square is a 1996 modem. Three sines in a 1 : 0.19 :
 * 0.07 ratio, each decaying faster than the one below it, is the cheapest thing that sounds
 * struck rather than switched on — the upper partials are the "clack" of the mallet and they
 * have to die first or the note turns into a whistle.
 */
export const PARTIALS: { ratio: number; gain: number; decay: number }[] = [
	{ ratio: 1, gain: 1, decay: 1 },
	{ ratio: 2, gain: 0.19, decay: 0.55 },
	{ ratio: 3, gain: 0.07, decay: 0.3 },
];

/** The attack, in seconds. Not zero: a gain that steps from 0 to 1 in one sample clicks. */
const ATTACK = 0.004;

// --- the part that makes a noise ---------------------------------------------------

/**
 * One `AudioContext` for the app, built on the first cue rather than at import.
 *
 * Browsers refuse to start an audio context that has not been asked for by a gesture, and a
 * context created at load and left suspended counts against the page for as long as it
 * lives. Building it lazily means the first sound the app plays is, by definition, after the
 * user has been in the page — and `unlock()` below covers the one case where it is not.
 */
let context: AudioContext | undefined;

function audio(): AudioContext | undefined {
	if (context) return context;
	const Ctor = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
	if (!Ctor) return undefined;
	try {
		context = new Ctor();
	} catch {
		return undefined;
	}
	return context;
}

/**
 * Resume the context on the first real interaction.
 *
 * Safari and Chrome both start a context suspended when the page has not been touched, and
 * an agent can finish a turn before the user has clicked anything — a cue that is silently
 * dropped for that reason looks exactly like a cue that is broken. Called once from
 * `App.tsx`; returns its own cleanup.
 */
export function unlockOnGesture(): () => void {
	const wake = () => {
		const ctx = audio();
		if (ctx?.state === "suspended") void ctx.resume().catch(() => undefined);
	};
	const events = ["pointerdown", "keydown", "touchstart"] as const;
	for (const name of events) window.addEventListener(name, wake, { passive: true });
	return () => {
		for (const name of events) window.removeEventListener(name, wake);
	};
}

/**
 * Play a cue. Silent, and *not* an error, when the choice is "none" or audio is unavailable.
 *
 * Every failure here is swallowed on purpose. A notification sound is the least important
 * thing on the page, and there is no version of "the speakers are busy" that a person
 * working on a board needs to be told about in a toast.
 */
export function play(id: SoundChoice | undefined, volume = 0.7): void {
	const found = cue(id);
	if (!found || volume <= 0) return;
	const ctx = audio();
	if (!ctx) return;
	if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);

	const master = ctx.createGain();
	// Squared, because loudness is not linear in amplitude: a slider at half way that halves
	// the number sounds like about three quarters, and people set it back down again.
	master.gain.value = Math.min(1, volume) ** 2 * 0.5;
	master.connect(ctx.destination);

	const start = ctx.currentTime + 0.01;
	for (const note of found.notes) {
		const base = hz(note.pitch);
		const at = start + note.at / 1000;
		const seconds = note.ms / 1000;
		for (const partial of PARTIALS) {
			const osc = ctx.createOscillator();
			osc.type = "sine";
			osc.frequency.value = base * partial.ratio;
			const env = ctx.createGain();
			const peak = note.gain * partial.gain;
			env.gain.setValueAtTime(0.0001, at);
			env.gain.exponentialRampToValueAtTime(peak, at + ATTACK);
			// Exponential rather than linear: a linear fade is audible as a swell that stops,
			// where an exponential one is a note that was struck.
			env.gain.exponentialRampToValueAtTime(0.0001, at + seconds * partial.decay);
			osc.connect(env);
			env.connect(master);
			osc.start(at);
			osc.stop(at + seconds * partial.decay + 0.02);
		}
	}

	// Let the last tail finish, then drop the graph. Without this the master gains pile up
	// for as long as the tab is open.
	const total = cueLength(id) / 1000 + 0.1;
	window.setTimeout(() => master.disconnect(), (total + 0.1) * 1000);
}
