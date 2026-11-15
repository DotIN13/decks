/**
 * Voice input in the composer: the recording has the controls row to itself, words show as they are
 * heard, ✓ keeps them and ✕ throws them away, and a refused microphone says the real reason.
 *
 * The row used to put the recording's red stop beside the turn's red stop, with the meter and timer
 * squeezed into dots and no way to throw a take away on a phone; and every refusal read "not allowed",
 * which on a Mac mini with no microphone at all was the wrong reason.
 *
 * Needs no model and no microphone: the init script hands the page a silent stream, and a recogniser
 * that says what the check tells it to.
 */
import { open, resetStage, rest, say, settle } from "../harness.mjs";

const init = () => {
	try {
		localStorage.setItem("decks.voice.recogniser", "browser");
	} catch {}
	window.__voice = { fail: "", heard: [] };
	const devices = navigator.mediaDevices ?? {};
	Object.defineProperty(navigator, "mediaDevices", { value: devices, configurable: true });
	devices.getUserMedia = async () => {
		if (window.__voice.fail) throw Object.assign(new Error(window.__voice.fail === "NotAllowedError" ? "Permission denied by system" : "Requested device not found"), { name: window.__voice.fail });
		return new AudioContext().createMediaStreamDestination().stream;
	};
	class FakeRecognition {
		start() {
			window.__voice.live = this;
		}
		stop() {
			setTimeout(() => this.onend?.(), 20);
		}
		abort() {}
		say(settled, pending) {
			const results = [];
			if (settled) results.push(Object.assign([{ transcript: settled }], { isFinal: true }));
			if (pending) results.push(Object.assign([{ transcript: pending }], { isFinal: false }));
			this.onresult?.({ results });
		}
	}
	window.SpeechRecognition = FakeRecognition;
	window.webkitSpeechRecognition = FakeRecognition;
};

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900, init });
await rest(page, { start: 0 });
const field = page.locator(".dockfield").first();
await field.waitFor({ timeout: 15000 });
const row = () =>
	page.evaluate(() => {
		const rec = document.querySelector(".composer-recording");
		const shown = (sel) => [...document.querySelectorAll(sel)].some((el) => el.getClientRects().length > 0);
		return {
			recording: !!rec,
			discard: shown(".composer-discard"),
			done: shown(".composer-done"),
			send: shown(".send-button:not(.composer-done)"),
			wave: rec?.querySelector(".composer-wave")?.getBoundingClientRect().width ?? 0,
			clock: rec?.querySelector(".composer-clock")?.textContent ?? "",
			live: document.querySelector(".composer-live")?.textContent ?? "",
			pending: document.querySelector(".composer-live-pending")?.textContent?.trim() ?? "",
			text: document.querySelector(".dockfield")?.textContent ?? "",
		};
	});

// Recording: the row is ✕, the meter, the time and ✓, and nothing else.
await page.locator(".composer-mic").first().click();
await page.waitForSelector(".composer-recording", { timeout: 5000 });
await settle(page, 300);
let now = await row();
say("recording takes over the row: one discard, one done, no send or stop beside them", now.discard && now.done && !now.send, JSON.stringify(now));
say("the meter has room", now.wave > 150, `${Math.round(now.wave)} px`);
say("the timer reads as a time", /^\d+:\d\d$/.test(now.clock), now.clock);

// Words as they are heard: settled dark, the rest grey.
await page.evaluate(() => window.__voice.live.say("hello there", "general"));
await settle(page, 100);
now = await row();
say("heard words show while recording, the unsettled ones apart", now.live.includes("hello there") && now.pending === "general", JSON.stringify({ live: now.live, pending: now.pending }));

// ✓ keeps them, in the box.
await page.locator(".composer-done").click();
await page.waitForFunction(() => !document.querySelector(".composer-recording"), null, { timeout: 5000 });
await settle(page, 200);
now = await row();
say("done puts the words in the box and gives the row back", now.text.includes("hello there general") && now.send && !now.recording, JSON.stringify({ text: now.text, send: now.send }));

// ✕ throws a take away and leaves the box as it was.
await page.locator(".composer-mic").first().click();
await page.waitForSelector(".composer-recording", { timeout: 5000 });
await page.evaluate(() => window.__voice.live.say("throw this away", ""));
await page.locator(".composer-discard").click();
await settle(page, 200);
now = await row();
say("discard keeps nothing", !now.recording && !now.text.includes("throw this away") && now.text.includes("hello there general"), now.text);

// A refused microphone says why.
const refusal = async (name) => {
	await page.evaluate((one) => (window.__voice.fail = one), name);
	await page.locator(".composer-mic").first().click();
	await settle(page, 400);
	return page.evaluate(() => [...document.querySelectorAll(".notice")].map((el) => (el.textContent ?? "").trim()).join(" | "));
};
const none = await refusal("NotFoundError");
say("no microphone is said as no microphone, not as not allowed", /No microphone is connected/.test(none) && !/not allowed/i.test(none), none);
const blocked = await refusal("NotAllowedError");
say("a microphone the computer holds back names where to let it through", /Privacy & Security/.test(blocked), blocked);

say("no errors on the page", errors.length === 0, errors.join(" | "));
await browser.close();
