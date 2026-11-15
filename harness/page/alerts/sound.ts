/**
 * The cues: opencode's sound library, in this package's `sounds/`, served at `/sounds/`
 * (`decksSounds()`).
 */

/**
 * The five families, which is how the picker groups them.
 */
export const SOUND_FAMILIES = [
	{ id: "staplebops", label: "Staplebops", count: 7 },
	{ id: "bip-bop", label: "Bip bop", count: 10 },
	{ id: "alert", label: "Alert", count: 10 },
	{ id: "yup", label: "Yup", count: 6 },
	{ id: "nope", label: "Nope", count: 12 },
] as const;

export type SoundFamily = (typeof SOUND_FAMILIES)[number]["id"];

/** Every id, in family order. `staplebops-01`, `bip-bop-04`, …: the filename without `.mp3`. */
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

/**
 * Where the cues are served: `/sounds/` on the page's own origin by default, which is where
 * the page's Vite config serves them from `alerts/sounds/`, in dev and in a build.
 */
const where = { base: "/sounds/" };
export function setSoundBase(base: string): void {
	where.base = base.endsWith("/") ? base : `${base}/`;
	warmed.clear();
}

/** Where the file is. Relative, because the app is served from its own origin. */
export function soundUrl(id: string): string | undefined {
	if (!isSound(id) || id === SILENT) return undefined;
	return `${where.base}${id}.mp3`;
}

/**
 * What to call one in the picker: the family, then the number.
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
 */
export function preload(ids: Iterable<string>): void {
	for (const id of ids) element(id);
}

/**
 * Play a cue. Silent, and not an error, when the choice is `none` or audio is unavailable.
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
