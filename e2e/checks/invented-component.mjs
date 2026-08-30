/**
 * A component the agent invented, and the promise the board-authoring skill makes to it.
 *
 * The skill tells the agent to build shapes the catalogue does not have, in exchange for
 * three rules: a `data-id` on a direct child of the body, a box class beside its own, and
 * a `data-edit` naming every run of words. This is the example printed in that skill, so a
 * failure here means the documentation is lying to every agent that reads it — which is a
 * worse bug than a broken control, because nobody would think to check.
 *
 * The board also carries its own `<style>`, because "your CSS goes in the board" is the
 * other half of the advice and would be worthless if board.js touched it.
 */
import { rmSync } from "node:fs";
import { boardPath, open, read, say, socket, write } from "../harness.mjs";

async function until(file, pattern, timeout = 15000) {
	const deadline = Date.now() + timeout;
	let last = "";
	while (Date.now() < deadline) {
		last = read(file);
		if (pattern.test(last)) return last;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return last;
}

const fixture = await boardPath("invented-fixture.html");
const path = "boards/invented-fixture.html";

write(
	fixture,
	`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Invented fixture</title>
		<meta name="board" content='{"w":1200,"h":800,"bg":"grid"}' />
		<link rel="stylesheet" href="../lib/board.css" />
		<style>
			.phase { display: grid; grid-template-columns: 88px 1fr; gap: var(--b-unit); }
			.phase > .when { color: var(--b-faint); font-family: var(--b-mono); }
		</style>
	</head>
	<body class="board">
		<section class="card phases" data-id="rollout" style="left: 48px; top: 48px; width: 420px">
			<h3 data-edit="rollout-title">Rollout</h3>
			<div class="phase"><span class="when" data-edit="rollout-when-1">week 1</span><span data-edit="rollout-what-1">Lock behind a flag</span></div>
			<div class="phase"><span class="when" data-edit="rollout-when-2">week 2</span><span data-edit="rollout-what-2">Ramp to 10%</span></div>
		</section>
		<script src="../lib/board.js"></script>
	</body>
</html>
`,
);

const link = await socket();
link.send({ type: "board.play", path });
await new Promise((resolve) => setTimeout(resolve, 500));
link.close();

const { browser, page, errors } = await open();
try {
	await page.waitForFunction(
		(wanted) => document.querySelector(`.board-node[data-path="${wanted}"] iframe`)?.contentWindow?.__boardReady === true,
		path,
		{ timeout: 20000 },
	);
	await page.evaluate((wanted) => {
		[...document.querySelectorAll(".rail-item")].find((item) => item.textContent.includes(wanted))?.click();
	}, "invented-fixture");
	await page.waitForSelector(".palette", { state: "visible", timeout: 8000 });

	const frame = () => page.frameLocator(`.board-node[data-path="${path}"] iframe`);
	const inspector = page.locator(".inspector");

	// --- board.js leaves what it does not own alone -----------------------------------

	say(
		"the board's own stylesheet survives and applies",
		(await frame().locator(".phase").first().evaluate((el) => getComputedStyle(el).display)) === "grid",
	);
	say(
		"an invented class is still on the element after board.js has run",
		await frame().locator("[data-id='rollout']").evaluate((el) => el.classList.contains("phases")),
	);

	// --- rule one: a data-id on a child of the body is a component --------------------

	const box = await frame().locator("[data-id='rollout'] h3").boundingBox();
	await page.mouse.click(box.x + 8, box.y + 8);
	await inspector.waitFor({ timeout: 5000 });
	say("an invented component selects like any other", await inspector.isVisible());
	say(
		"and it is named by its own id, not by the class it borrowed",
		(await page.locator('.inspector input[name="name"]').inputValue()) === "rollout",
	);

	// --- rule two: the box class buys the appearance rows -----------------------------

	say(
		"a box class beside its own earns the class switch",
		(await page.locator(".inspector button[data-box]").count()) > 0,
	);
	await page.locator('.inspector button[data-box="callout"]').click();
	const swapped = await until(fixture, /class="callout phases"/);
	say(
		"and a swap replaces only the box class, keeping the invented one",
		/<section class="callout phases" data-id="rollout"/.test(swapped),
		swapped.split("\n").find((line) => line.includes('data-id="rollout"'))?.trim(),
	);

	// --- rule three: a name on every run, so each one retypes -------------------------

	const label = await frame().locator("[data-id='rollout'] .phase .when").first().boundingBox();
	await page.mouse.dblclick(label.x + label.width / 2, label.y + label.height / 2);
	await page.keyboard.press("ControlOrMeta+a");
	await page.keyboard.type("week 3");
	// Commit, not Escape: Escape is the cancel, and reverts to what the file said.
	await page.keyboard.press("ControlOrMeta+Enter");
	const retyped = await until(fixture, /week 3/);
	say(
		"a named leaf deep inside an invented component retypes in place",
		/<span class="when" data-edit="rollout-when-1">week 3<\/span>/.test(retyped),
		retyped.split("\n").find((line) => line.includes("week 3"))?.trim(),
	);
	say(
		"and the retype touched one line and nothing else",
		retyped.split("\n").filter((line, index) => line !== swapped.split("\n")[index]).length === 1,
	);

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	rmSync(fixture, { force: true });
	await page.waitForTimeout(600);
	await browser.close();
}
