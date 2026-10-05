import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * What a film or a sound says about itself, and the still that stands for it.
 *
 * A media item on a stage has to be placed before anything has been decoded: it needs a shape to
 * take, a running time to print, and something to draw while it is not playing. None of that can
 * be read from the bytes without a decoder, so the server asks ffmpeg, once, when the file lands.
 *
 * **ffmpeg, and not ffprobe.** `ffmpeg -i` with no output is an error by design, and on its way
 * out it prints the container and its streams — the running time and the picture's size are in
 * there, which is everything wanted here. ffprobe would answer in JSON and be a second binary of
 * 45MB for it.
 *
 * **Found, not bundled.** `DECKS_FFMPEG` names it, or it is `ffmpeg` on the PATH. It is not a
 * package dependency on purpose: there is one copy of a 51MB binary on this machine and eight
 * `node_modules` trees that would each have carried their own.
 */

/** The command, which a deployment may point elsewhere. */
export const ffmpegCommand = (): string => process.env.DECKS_FFMPEG || "ffmpeg";

export interface MediaFacts {
	kind: "video" | "audio";
	/** Whole seconds, when the container says. */
	seconds?: number;
	/** The picture's own size, for a film: what the item's shape should be. */
	w?: number;
	h?: number;
	/** What is inside, as ffmpeg names it: `h264`, `vp9`, `aac`. */
	codec?: string;
}

/** Whether ffmpeg can be run at all. Asked once; a deployment without it is not an error. */
let present: boolean | undefined;
export async function ffmpegReady(): Promise<boolean> {
	if (present !== undefined) return present;
	present = await run(ffmpegCommand(), ["-hide_banner", "-version"]).then(
		() => true,
		() => false,
	);
	if (!present) console.warn("[decks] no ffmpeg: a film gets no poster and no running time. Set DECKS_FFMPEG or put one on the PATH.");
	return present;
}

/** Forget the answer, for a test that installs one or takes one away. */
export function forgetFfmpeg(): void {
	present = undefined;
}

const TIME = /Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)/;
/** The first video stream's codec and the size on the same line; `is` because the line is long. */
const PICTURE = /Video: ([a-z0-9]+).*?, (\d+)x(\d+)/is;
const SOUND = /Audio: ([a-z0-9]+)/i;

/**
 * What is in a media file, or `undefined` for anything that is not one.
 *
 * A file that is not there and a file with nothing playable in it are both `undefined` here: the
 * caller has the path and knows which it handed over.
 */
export async function mediaFacts(file: string): Promise<MediaFacts | undefined> {
	if (!(await ffmpegReady())) return undefined;
	const text = await run(ffmpegCommand(), ["-hide_banner", "-i", file], { maxBuffer: 1 << 20 }).then(
		() => "",
		(error: { stderr?: string }) => String(error.stderr ?? ""),
	);
	if (!/Stream #/.test(text)) return undefined;
	const picture = PICTURE.exec(text);
	const sound = SOUND.exec(text);
	if (!picture && !sound) return undefined;
	const time = TIME.exec(text);
	const seconds = time ? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) : undefined;
	return {
		kind: picture ? "video" : "audio",
		...(seconds === undefined || !Number.isFinite(seconds) ? {} : { seconds: Math.round(seconds) }),
		...(picture ? { w: Number(picture[2]), h: Number(picture[3]) } : {}),
		...(picture?.[1] || sound?.[1] ? { codec: picture?.[1] ?? sound?.[1] } : {}),
	};
}

/** How wide a poster is written. Wide enough for a film at reading distance, small enough to be a still. */
export const POSTER_WIDTH = 960;

/** The deck-relative path a file's poster is kept at, beside the file itself. */
export function posterPath(asset: string): string {
	return `${asset}.poster.jpg`;
}

/**
 * Write the still that stands for a film: one frame, a fifth of the way in.
 *
 * Not the first frame, which is black in anything that fades in — both of this deck's films open
 * on black, and a wall of black rectangles is no better than a wall of empty ones. Ten seconds is
 * the furthest it will go, so a long film is still answered quickly.
 */
export async function writePoster(deck: string, asset: string, facts?: MediaFacts): Promise<string | undefined> {
	if (!(await ffmpegReady())) return undefined;
	const file = join(deck, asset);
	if (!existsSync(file)) return undefined;
	const relative = posterPath(asset);
	const to = join(deck, relative);
	const at = facts?.seconds ? Math.min(facts.seconds * 0.2, 10) : 1;
	try {
		// `-ss` before `-i` seeks by the container's index, which is why this is tens of milliseconds.
		await run(ffmpegCommand(), ["-hide_banner", "-loglevel", "error", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", `scale=${POSTER_WIDTH}:-2`, "-q:v", "4", "-y", to], { maxBuffer: 1 << 20 });
		const written = await stat(to);
		if (written.size > 0) return relative;
		await unlink(to).catch(() => {});
		return undefined;
	} catch {
		// A film with no decodable frame at that point is not a failure worth refusing an upload over.
		await unlink(to).catch(() => {});
		return undefined;
	}
}
