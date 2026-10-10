/**
 * A film or a sound as an item on the canvas.
 *
 * It is pen's own rectangle, filled with the still the server wrote and marked `decks.media`
 * (`@decks/pen`, `MEDIA`), and the canvas paints its controls on it rather than mounting a
 * player until it is pressed: forty-eight films playing cost about a thousand times what forty-eight stills cost, so
 * nothing decodes until one is pressed.
 *
 * Needs no model: the item goes on over the wire as `stage.pen.edit`, which is the same operation
 * an agent's `stage.pen.edit` takes, through the same server path.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deckState, editMode, open, resetStage, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

await resetStage();
const deck = await deckState();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
await settle(page, 1500);
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
say("the server says which agent is focused", !!agentId);

// The stage's file, found from the frame the server sends after the first edit.
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "note", id: "media-anchor", content: "x" }, box: { x1: -4000, y1: -4000 } }] });
const frame = await until(() => link.received.filter((m) => m.type === "stage.pen" && m.agentId === agentId && m.doc.children.some((n) => n.id === "media-anchor")).at(-1));
const file = frame ? join(deck.path, "stages", frame.stage, "stage.pen") : "";
/*
 * The stage file as it is now. Tolerant of a torn read: the server rewrites it while a check is
 * polling, and reading it mid-write once crashed a whole check on a JSON error. The last good
 * answer stands until the next complete one.
 */
let lastGood = { children: [] };
const onDisk = () => {
	if (!existsSync(file)) return { children: [] };
	try {
		lastGood = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		/* half-written; the poll comes round again */
	}
	return lastGood;
};
say("the stage has a file to draw in", existsSync(file), file);

await editMode(page, true);

/*
 * Somewhere empty to put them, in stage coordinates. A film over a board would still draw, but a
 * press on it is a press on the board's page, and the point here is to press the item.
 */
const spot = await page.evaluate(() => {
	const stage = document.querySelector(".stage");
	const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform);
	const empty = (x, y) => document.elementFromPoint(x, y) === stage;
	for (let y = 160; y < 760; y += 40) {
		for (let x = 360; x < 1200; x += 40) {
			if (empty(x, y) && empty(x + 320, y) && empty(x, y + 300) && empty(x + 320, y + 300)) return { x: (x - m.e) / m.a, y: (y - m.f) / m.a };
		}
	}
});
say("the canvas has room for them", !!spot);

if (spot) {
	const film = {
		type: "rectangle",
		id: "media-film",
		name: "a-film.mp4",
		cornerRadius: 8,
		fill: "#1f2328",
		metadata: { type: "decks.media", kind: "video", file: "assets/a-film.mp4", seconds: 64 },
	};
	const sound = {
		type: "rectangle",
		id: "media-sound",
		name: "a-talk.m4a",
		cornerRadius: 8,
		fill: "#e8eaed",
		metadata: { type: "decks.media", kind: "audio", file: "assets/a-talk.m4a", seconds: 905 },
	};
	link.send({
		type: "stage.pen.edit",
		agentId,
		ops: [
			{ op: "insert", node: film, box: { x1: Math.round(spot.x), y1: Math.round(spot.y), x2: Math.round(spot.x) + 320, y2: Math.round(spot.y) + 180 } },
			{ op: "insert", node: sound, box: { x1: Math.round(spot.x), y1: Math.round(spot.y) + 220, x2: Math.round(spot.x) + 420, y2: Math.round(spot.y) + 292 } },
		],
	});

	const written = await until(() => {
		const items = onDisk().children.filter((n) => n.metadata?.type === "decks.media");
		return items.length === 2 ? items : undefined;
	});
	say("a film and a sound are rectangles marked decks.media in the file", !!written, JSON.stringify(written?.map((n) => n.metadata)));
	// A rectangle is what pen.dev opens, which is the whole reason for the shape.
	say("…and pen's own type, so another tool can open the stage", written?.every((n) => n.type === "rectangle") === true, JSON.stringify(written?.map((n) => n.type)));

	const boxOf = (id) => page.evaluate((one) => globalThis.__decksPenBox?.(one), id);
	const filmBox = await until(async () => {
		const box = await boxOf("media-film");
		return box && box.width > 0 ? box : undefined;
	});
	say("the canvas draws the film where the file puts it", !!filmBox && Math.round(filmBox.width / (filmBox.height || 1)) === 2, JSON.stringify(filmBox && { w: Math.round(filmBox.width), h: Math.round(filmBox.height) }));

	/*
	 * Pressed once, it plays: one player mounts over it, and the press selects it as any press on
	 * an item does. The item has to be on screen; nothing else is asked of the zoom.
	 */
	if (filmBox) {
		const players = await page.evaluate(() => document.querySelectorAll("video, audio").length);
		say("nothing is decoding: there is no player on the canvas at rest", players === 0, `players ${players}`);
		await page.mouse.click(filmBox.x + filmBox.width * 0.75, filmBox.y + filmBox.height * 0.4);
		const player = await until(() => page.evaluate(() => {
			const one = document.querySelector(".pen-player video");
			return one ? { players: document.querySelectorAll(".pen-player video, .pen-player audio").length, src: one.getAttribute("src") } : undefined;
		}));
		say("one click on a film mounts one player over it", !!player && player.players === 1, JSON.stringify(player));
		say("…and it plays the file the item names", (player?.src ?? "").includes("a-film.mp4"), player?.src);
		const picked = await until(() => page.evaluate(() => document.querySelectorAll(".pen-selection:not([data-board])").length === 1));
		say("…and the click selects it, as any drawn item", !!picked);

		// Letting go of the item does not stop it: a film keeps playing while you work elsewhere.
		await page.keyboard.press("Escape");
		await settle(page, 400);
		const kept = await page.evaluate(() => document.querySelectorAll(".pen-player").length === 1);
		say("…and letting go of it leaves it playing", kept);

		// The sound's own play button, where the still drew it, starts it in the film's place.
		const sound = await boxOf("media-sound");
		await page.mouse.click(sound.x + sound.height / 2, sound.y + sound.height / 2);
		const swapped = await until(() => page.evaluate(() => (document.querySelector(".pen-player")?.dataset.kind === "audio" && document.querySelectorAll(".pen-player").length === 1 ? true : undefined)));
		say("a click on a sound plays it instead: one player at a time", !!swapped);
		const parts = await page.evaluate(() => ({ disc: !!document.querySelector(".pen-player-disc"), wave: !!document.querySelector(".pen-player-wave"), name: document.querySelector(".pen-player-name")?.textContent }));
		say("…drawn as its card: a play button, its name and its waveform", parts.disc && parts.wave && parts.name === "a-talk.m4a", JSON.stringify(parts));
	}

	const soundBox = await boxOf("media-sound");
	say("a sound is a strip, not a black box", !!soundBox && soundBox.height < soundBox.width / 3, JSON.stringify(soundBox && { w: Math.round(soundBox.width), h: Math.round(soundBox.height) }));

	// Left as it was found.
	link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "media-film" }, { op: "delete", id: "media-sound" }] });
}

link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "media-anchor" }] });
await settle(page, 300);
await editMode(page, false);
link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
