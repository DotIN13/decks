/**
 * Dropping a file from the desktop onto a board (DESIGN §3, §6.5).
 *
 * The interesting part is where the events happen: a board frame is a separate
 * document, so the drop is dispatched *into* `frame.contentDocument` here, exactly
 * as a real one arrives. Two claims are worth a check rather than a comment — that
 * in-frame drag coordinates are board coordinates (the component has to land under
 * the cursor, at any zoom), and that a drop the boards do not take cannot navigate
 * the app away.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { boardReady, changed, deckState, open, read, say, socket, write } from "../harness.mjs";

const deck = await deckState();
const path = "boards/drop-fixture.html";
const fixture = `${deck.path}/${path}`;
const assets = `${deck.path}/assets`;

const original = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Drop fixture</title>
		<meta name="board" content='{"w":1200,"h":800,"bg":"grid"}' />
		<link rel="stylesheet" href="../lib/board.css" />
	</head>
	<body class="board">
		<section class="card" data-id="what" style="left: 24px; top: 24px; width: 300px">
			<h3>Drop files below</h3>
		</section>
		<script src="../lib/board.js"></script>
	</body>
</html>
`;
write(fixture, original);

const link = await socket();
link.send({ type: "board.play", path });
await new Promise((resolve) => setTimeout(resolve, 500));
link.close();

// One PNG and one text file, as base64: a drop carries bytes, so the check has to
// supply real ones. The PNG is 24x48 — twice as tall as it is wide, so a component
// sized from a default box and one sized from the picture cannot be confused.
const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAABgAAAAwCAIAAACE6i30AAAAK0lEQVR4nO3MMQ0AAAgDsMlBE9oRg4mdTXo3t1MRkUgkEolEIpFIJBI1oweXkCdb46qvjQAAAABJRU5ErkJggg==";
const TEXT = Buffer.from(Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n")).toString("base64");

const { browser, page, errors } = await open();
const before = new Set(existsSync(assets) ? readdirSync(assets) : []);
try {
	await boardReady(page, path);

	// Zoom in, as a user reaching for a board does: below INTERACT_ZOOM the frame is
	// inert and takes no drops at all.
	await page.evaluate(() => {
		[...document.querySelectorAll(".board-row")].find((i) => i.textContent.includes("drop-fixture"))?.click();
	});
	await page.waitForSelector(".palette", { state: "visible", timeout: 8000 });

	const frameOf = async () => {
		const handle = await page.locator(`.board-node[data-path="${path}"] iframe`).elementHandle();
		return handle.contentFrame();
	};

	/** Dispatch one stage of a file drag inside the board's own document. */
	const send = async (type, files, at) => {
		const frame = await frameOf();
		return frame.evaluate(
			({ type, files, at }) => {
				const transfer = new DataTransfer();
				for (const file of files) {
					const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
					transfer.items.add(new File([bytes], file.name));
				}
				const target = document.elementFromPoint(at.x, at.y) ?? document.body;
				target.dispatchEvent(
					new DragEvent(type, {
						bubbles: true,
						cancelable: true,
						clientX: at.x,
						clientY: at.y,
						dataTransfer: transfer,
					}),
				);
				return document.querySelector(".decks-drop span")?.textContent ?? null;
			},
			{ type, files, at },
		);
	};

	const files = [
		{ name: "e2e drop.png", base64: PNG },
		{ name: "e2e-drop.txt", base64: TEXT },
	];
	const at = { x: 200, y: 400 };

	const label = await send("dragenter", files, at);
	say("the board says what is about to land on it", label === "Drop 2 files here", String(label));

	await send("drop", files, at);
	const dropped = await changed(fixture, original);
	say(
		"the drop is highlighted only while the drag lasts",
		await (await frameOf()).evaluate(() => document.querySelector(".decks-drop") === null),
	);

	const added = readdirSync(assets).filter((name) => !before.has(name));
	say(
		"the files are copied into the deck's assets/, named readably",
		added.includes("e2e-drop.png") && added.includes("e2e-drop.txt"),
		added.join(" "),
	);

	const image = /<div class="embed" data-id="(image-\d+)" data-embed="\.\.\/assets\/e2e-drop\.png" style="left: (\d+)px; top: (\d+)px; width: (\d+)px; height: (\d+)px"/.exec(dropped);
	say("an image lands as an embed pointing at the copy in the deck", Boolean(image), dropped.match(/data-embed="[^"]*"/g)?.join(" "));
	// 400 snaps to 400 on the 8px grid, so the component's top-left is the drop point:
	// in-frame drag coordinates are board coordinates, whatever the camera is doing.
	say("it lands at the drop point, in board coordinates", image?.[2] === "200" && image?.[3] === "400", `left ${image?.[2]} top ${image?.[3]}`);
	// 24x48 is a 1:2 picture, so a component sized from the file is taller than it is
	// wide; the old fixed 420x320 box was the other way round.
	say("an image is sized near its own aspect ratio", Number(image?.[5]) > Number(image?.[4]), `${image?.[4]}x${image?.[5]}`);

	const text = /data-id="(embed-\d+)" data-embed="\.\.\/assets\/e2e-drop\.txt" style="left: (\d+)px; top: (\d+)px/.exec(dropped);
	say("two files dropped together are two components, offset from each other", text?.[2] !== image?.[2], `${image?.[2]} vs ${text?.[2]}`);

	// The board mounts them: a picture and preformatted text, not two blank boxes.
	await page.waitForTimeout(1200);
	const kinds = await (await frameOf()).evaluate(() =>
		Object.fromEntries([...document.querySelectorAll(".embed")].map((el) => [el.dataset.id, el.dataset.kind])),
	);
	say("the board renders them as a picture and as text", kinds[image?.[1]] === "image" && kinds[text?.[1]] === "text", JSON.stringify(kinds));

	// The same bytes again: one asset, two components.
	const was = read(fixture);
	await send("drop", [files[0]], { x: 600, y: 200 });
	await changed(fixture, was);
	say(
		"the same file dropped twice is stored once",
		readdirSync(assets).filter((name) => name.startsWith("e2e-drop") && name.endsWith(".png")).length === 1,
		readdirSync(assets).join(" "),
	);

	// A drop that misses every board: a notice, and — the part that matters — an app
	// that is still there. The browser's default would have navigated to the file.
	await page.evaluate(() => {
		const transfer = new DataTransfer();
		transfer.items.add(new File([new Uint8Array([1, 2, 3])], "stray.bin"));
		const stage = document.querySelector(".stage");
		const box = stage.getBoundingClientRect();
		for (const type of ["dragover", "drop"]) {
			stage.dispatchEvent(
				new DragEvent(type, {
					bubbles: true,
					cancelable: true,
					clientX: box.left + 6,
					clientY: box.bottom - 6,
					dataTransfer: transfer,
				}),
			);
		}
	});
	await page.waitForTimeout(300);
	const notices = await page.evaluate(() => [...document.querySelectorAll(".notice")].map((n) => n.textContent));
	say("a file dropped on empty canvas is refused with a reason", notices.some((text) => /onto a board/.test(text)), notices.join(" | "));
	say("and the app is still the app", await page.evaluate(() => Boolean(document.querySelector(".stage"))));
	say("nothing was written for it", !readdirSync(assets).some((name) => name.includes("stray")));

	// The route's own guard, from outside the drag machinery: a name that is a path.
	const refused = await page.evaluate(async () => {
		const response = await fetch(`/api/upload?name=${encodeURIComponent("../../boards/drop-fixture.html")}`, {
			method: "POST",
			headers: { "Content-Type": "application/octet-stream" },
			body: new Uint8Array([0x70, 0x77, 0x6e]),
		});
		return { status: response.status, body: await response.json() };
	});
	say(
		"an upload cannot name a path out of assets/",
		refused.status === 200 && refused.body.path === "assets/drop-fixture.html",
		JSON.stringify(refused),
	);
	say("and the board it aimed at is untouched", read(fixture).includes("Drop files below"));

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	rmSync(fixture, { force: true });
	for (const name of readdirSync(assets)) {
		if (name.startsWith("e2e-drop") || name === "drop-fixture.html") rmSync(`${assets}/${name}`, { force: true });
	}
	await page.waitForTimeout(600);
	await browser.close();
}
