import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ffmpegCommand, ffmpegReady, forgetFfmpeg, mediaFacts, posterPath, writePoster } from "./media.ts";

/** A two-second silent film, made by ffmpeg itself, so the test needs nothing checked in. */
function makeFilm(deck: string, name: string, options: { size?: string; seconds?: number } = {}): string {
	const asset = `assets/${name}`;
	mkdirSync(join(deck, "assets"), { recursive: true });
	execFileSync(ffmpegCommand(), [
		"-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", `testsrc=size=${options.size ?? "320x180"}:rate=10:duration=${options.seconds ?? 2}`,
		"-pix_fmt", "yuv420p", "-y", join(deck, asset),
	]);
	return asset;
}

const have = await ffmpegReady();

test("a film says its kind, its running time and its own size", { skip: have ? false : "no ffmpeg on this machine" }, async () => {
	const deck = mkdtempSync(join(tmpdir(), "decks-media-"));
	try {
		const asset = makeFilm(deck, "film.mp4", { size: "640x360", seconds: 3 });
		const facts = await mediaFacts(join(deck, asset));
		assert.equal(facts?.kind, "video");
		assert.equal(facts?.w, 640);
		assert.equal(facts?.h, 360);
		assert.equal(facts?.seconds, 3);
		assert.equal(typeof facts?.codec, "string");
	} finally {
		rmSync(deck, { recursive: true, force: true });
	}
});

test("a poster is written beside the film, and a second ask does not write it again", { skip: have ? false : "no ffmpeg on this machine" }, async () => {
	const deck = mkdtempSync(join(tmpdir(), "decks-media-"));
	try {
		const asset = makeFilm(deck, "film.mp4");
		const facts = await mediaFacts(join(deck, asset));
		const poster = await writePoster(deck, asset, facts);
		assert.equal(poster, posterPath(asset));
		assert.ok(existsSync(join(deck, poster!)), "the still is on disk beside the film");
		assert.ok(existsSync(join(deck, `${asset}.poster.jpg`)), "named for the file it stands for");
	} finally {
		rmSync(deck, { recursive: true, force: true });
	}
});

test("a file that is not media, and one that is not there, are both no facts at all", { skip: have ? false : "no ffmpeg on this machine" }, async () => {
	const deck = mkdtempSync(join(tmpdir(), "decks-media-"));
	try {
		mkdirSync(join(deck, "assets"), { recursive: true });
		writeFileSync(join(deck, "assets/notes.txt"), "not a film");
		assert.equal(await mediaFacts(join(deck, "assets/notes.txt")), undefined);
		assert.equal(await mediaFacts(join(deck, "assets/gone.mp4")), undefined);
		assert.equal(await writePoster(deck, "assets/gone.mp4"), undefined, "no file, no poster");
	} finally {
		rmSync(deck, { recursive: true, force: true });
	}
});

test("a deployment with no ffmpeg is not an error: everything answers nothing", async () => {
	const was = process.env.DECKS_FFMPEG;
	process.env.DECKS_FFMPEG = join(tmpdir(), "decks-no-such-ffmpeg");
	forgetFfmpeg();
	try {
		assert.equal(await ffmpegReady(), false);
		assert.equal(await mediaFacts("/anything.mp4"), undefined);
		assert.equal(await writePoster(tmpdir(), "assets/anything.mp4"), undefined);
	} finally {
		if (was === undefined) delete process.env.DECKS_FFMPEG;
		else process.env.DECKS_FFMPEG = was;
		forgetFfmpeg();
	}
});
