/**
 * Words selected in a card copy as words, in Chromium and in WebKit (Safari's engine).
 *
 * A card is drawn in a closed shadow root on the canvas, and the canvas's own ⌘C (`frame/inside/clipboard.ts`)
 * copies the selected items as a clip, standing aside only when words are selected. Selecting words in a
 * card selects the card too; where the frame's selection cannot see into the card's closed root (WebKit),
 * the canvas took the copy and put the card on the clipboard as an item, and the words never got there.
 * Each engine: a drag across a line of the card, ⌘C, and the copy is left to the browser (the canvas
 * neither cancels it nor writes a clip into it); then, with no words selected, ⌘C on the selected card
 * is the canvas's, a clip as before. Read off the copy event itself, after the canvas has had it.
 */
import { canvasFrame, card, open, resetStage, rest, say, selectCard, settle } from "../harness.mjs";

await resetStage();
for (const engine of ["chromium", "webkit"]) {
	const { browser, page, errors } = await open({ width: 1400, height: 900, engine });
	const frame = await canvasFrame(page);
	await rest(page);
	const path = card("plan");
	await selectCard(page, path);
	await settle(page, 1200);
	// What a copy did, read after the canvas's own listener (added first) has had it.
	await frame.evaluate(() => addEventListener("copy", (event) => (globalThis.__copied = { canceled: event.defaultPrevented, clip: (event.clipboardData?.getData("text/html") ?? "").includes("decks") })));
	const copyNow = async () => {
		await frame.evaluate(() => (globalThis.__copied = null));
		await page.keyboard.press(engine === "webkit" ? "Meta+c" : "ControlOrMeta+c");
		await settle(page, 300);
		return frame.evaluate(() => globalThis.__copied);
	};

	// The card's root is closed, so its words are found as a person finds them: across the lines under its top edge.
	const host = await frame.evaluate((wanted) => {
		const node = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted);
		const r = node?.querySelector(".card-host")?.getBoundingClientRect();
		return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
	}, path);
	say(`${engine}: the card is awake, with its page on the canvas`, !!host, JSON.stringify(host));
	const box = await (await frame.frameElement()).boundingBox();
	let copied = null;
	for (let dy = 0.03; dy < 0.3; dy += 0.03) {
		const y = box.y + host.y + host.h * dy;
		await page.mouse.move(box.x + host.x + host.w * 0.04, y);
		await page.mouse.down();
		await page.mouse.move(box.x + host.x + host.w * 0.5, y, { steps: 10 });
		await page.mouse.up();
		await settle(page, 150);
		copied = await copyNow();
		// A drag that landed on words: the canvas left the copy alone. One that missed copies the selected card, and the next line down is tried.
		if (copied && copied.canceled === false) break;
	}
	say(`${engine}: ⌘C over words dragged across in a card is the browser's: the canvas does not take it`, copied?.canceled === false && copied?.clip === false, JSON.stringify(copied));

	// No words selected: the selected card is copied as the canvas's clip, as before.
	await frame.evaluate(() => getSelection()?.removeAllRanges());
	await selectCard(page, path);
	await settle(page, 400);
	await frame.evaluate(() => getSelection()?.removeAllRanges());
	const asItem = await copyNow();
	say(`${engine}: with no words selected, ⌘C copies the selected card as the canvas's clip`, asItem?.canceled === true && asItem?.clip === true, JSON.stringify(asItem));

	say(`${engine}: no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
	await browser.close();
}
