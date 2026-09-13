/**
 * The app's cues: opencode's sound library, played from `public/sounds`.
 *
 * These are opencode's files, vendored under its MIT licence with the notice beside them in
 * `public/sounds/LICENSE`. An earlier version of this module synthesised the cues from a
 * table of notes and an oscillator; that was smaller and it was worse, for the reason a
 * synthesised sound usually is — three sines with an exponential decay is recognisably a
 * program making a noise, and forty-five recorded cues by somebody who does this for a
 * living are recognisably not.
 *
 * ### Why `public/` rather than the bundle
 *
 * opencode reaches its set with `import.meta.glob`, which makes each file a module the
 * bundler hashes and a promise the app awaits. Here they are static files served by their own
 * names, which buys three things:
 *
 * - **Nothing is in the bundle.** The browser fetches exactly the one cue that is about to
 *   play, ~8kB, and then it is in the HTTP cache. The other forty-four are never touched.
 * - **The id is the filename.** `staplebops-01` is `/sounds/staplebops-01.mp3`, so a saved
 *   preference is legible and there is no table mapping names to hashed asset URLs.
 * - **Adding one is dropping a file in.** No glob to re-run, no list to keep in step beyond
 *   the ids below.
 *
 * One format, not two. opencode ships an `.aac` beside every `.mp3` and its web app globs the
 * `.aac`; mp3 plays in every browser this app targets, so vendoring both would double what is
 * on disk to save a couple of kilobytes on a file that is fetched once.
 */

/**
 * The five families, which is how the picker groups them.
 *
 * The names are opencode's and they are not descriptive, which is fine and is the reason the
 * picker previews on hover-and-press: nobody can tell `nope-03` from `nope-07` by reading,
 * and everybody can tell them apart by ear in a second and a half.
 */
export const SOUND_FAMILIES = [
	{ id: "staplebops", label: "Staplebops", count: 7 },
	{ id: "bip-bop", label: "Bip bop", count: 10 },
	{ id: "alert", label: "Alert", count: 10 },
	{ id: "yup", label: "Yup", count: 6 },
	{ id: "nope", label: "Nope", count: 12 },
] as const;

export type SoundFamily = (typeof SOUND_FAMILIES)[number]["id"];

/** Every id, in family order. `staplebops-01`, `bip-bop-04`, … — the filename without `.mp3`. */
export const SOUND_IDS: string[] = SOUND_FAMILIES.flatMap((family) =>
	Array.from({ length: family.count }, (_, index) => `${family.id}-${String(index + 1).padStart(2, "0")}`),
);

const KNOWN = new Set(SOUND_IDS);

/** `"none"` is a real choice rather than the absence of one. */
export type SoundChoice = string;
export const SILENT = "none";

/** Whether a saved or hand-edited preference names something this build can play. */
export function isSound(id: unknown): id is string {
	return id === SILENT || (typeof id === "string" && KNOWN.has(id));
}

/** Where the file is. Relative, because the app is served from its own origin. */
export function soundUrl(id: string): string | undefined {
	if (!isSound(id) || id === SILENT) return undefined;
	return `/sounds/${id}.mp3`;
}

/**
 * What to call one in the picker: the family, then the number.
 *
 * Split rather than title-cased whole, because the picker draws the family as a heading and
 * the number as the row — `staplebops-01` in a 132px popover is a word nobody reads to the
 * end, and `01` under **Staplebops** is two glances.
 */
export function soundLabel(id: string): { family: string; number: string } {
	const match = /^(.*)-(\d+)$/.exec(id);
	if (!match) return { family: id, number: "" };
	const family = SOUND_FAMILIES.find((item) => item.id === match[1]);
	return { family: family?.label ?? (match[1] as string), number: match[2] as string };
}

/** The whole name on one line, for the closed chip: `Staplebops 01`. */
export function soundName(id: string | undefined): string {
	if (!id || id === SILENT) return "Silent";
	const { family, number } = soundLabel(id);
	return number ? `${family} ${number}` : family;
}

// --- playing one -------------------------------------------------------------------

/**
 * One `<audio>` per cue, kept and cloned rather than rebuilt.
 *
 * The element is the thing that holds the decoded audio; making a new `Audio(src)` per play
 * re-fetches from the HTTP cache and decodes again, which is audible as a delay the first few
 * times. Cloning a warmed element does neither, and a clone is what allows two cues to
 * overlap — one element playing a second time from the top cuts the first off.
 */
const warmed = new Map<string, HTMLAudioElement>();

function element(id: string): HTMLAudioElement | undefined {
	if (typeof Audio === "undefined") return undefined;
	const url = soundUrl(id);
	if (!url) return undefined;
	const hit = warmed.get(id);
	if (hit) return hit;
	const audio = new Audio(url);
	audio.preload = "auto";
	warmed.set(id, audio);
	return audio;
}

/**
 * Fetch and decode a cue before it is needed.
 *
 * Called with the three configured cues on the first gesture, and with whatever the picker is
 * showing. Over the network the first play is otherwise a round trip late, which lands the
 * "it finished" sound after you have already looked.
 */
export function preload(ids: Iterable<string>): void {
	for (const id of ids) element(id);
}

/**
 * Play a cue. Silent, and not an error, when the choice is `none` or audio is unavailable.
 *
 * Every failure is swallowed on purpose — including the autoplay rejection, which is what
 * happens when a turn finishes before the user has touched the page at all. A notification
 * sound is the least important thing here, and there is no version of "the speakers are busy"
 * that somebody working on a board needs in a toast.
 */
export function play(id: string | undefined, volume = 0.65): void {
	if (!id || id === SILENT || volume <= 0) return;
	const base = element(id);
	if (!base) return;
	// `cloneNode` keeps the src and the browser's cache entry, so this costs no network.
	const node = base.cloneNode() as HTMLAudioElement;
	node.volume = Math.min(1, Math.max(0, volume));
	void node.play().catch(() => undefined);
}
