/**
 * A component the agent invented, and the promise the board-authoring skill makes to it.
 *
 * The skill tells the agent to build shapes the catalogue does not have, in exchange for
 * three rules: a `data-id` on a direct child of the body, a box class beside its own, and
 * one string per leaf element. This is the example printed in that skill, so a failure here
 * means the documentation is lying to every agent that reads it — which is a worse bug than
 * a broken control, because nobody would think to check.
 *
 * The third rule used to be `data-edit` on every run of words, and it is gone: a leaf
 * holding text is retypeable because of its shape, so what the skill asks for is the shape.
 * The two assertions at the end are what that rule buys — a leaf types, and the row holding
 * two of them does not.
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
			<h3>Rollout</h3>
			<div class="phase"><span class="when">week 1</span><span>Lock behind a flag</span></div>
			<div class="phase"><span class="when">week 2</span><span>Ramp to 10%</span></div>
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

const { browser, page, errors } = await open({ edit: true });
try {
	await page.waitForFunction(
		(wanted) => document.querySelector(`.board-node[data-path="${wanted}"] iframe`)?.contentWindow?.__boardReady === true,
		path,
		{ timeout: 20000 },
	);
	await page.evaluate((wanted) => {
		[...document.querySelectorAll(".board-row")].find((item) => item.textContent.includes(wanted))?.click();
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
	await page.waitForTimeout(300);

	/*
	 * The field is the **row**, not the span that was clicked.
	 *
	 * A run of words is one field however many marks it is made of, so clicking one of two
	 * spans opens both — a field you cannot type out of is worse than no field. Asserted
	 * rather than assumed, because it is the difference between this and the leaf-only rule
	 * it replaced, and because the next assertion is meaningless without it.
	 */
	const field = await page.evaluate(() => {
		const doc = document.querySelector(`.board-node[data-path="boards/invented-fixture.html"] iframe`).contentDocument;
		const active = doc.activeElement;
		return active?.isContentEditable ? { tag: active.tagName.toLowerCase(), cls: active.className } : null;
	});
	say(
		"clicking one span of a row opens the whole run, marks and all",
		field?.tag === "div" && field?.cls === "phase",
		JSON.stringify(field),
	);

	/*
	 * And retyping part of it leaves the rest alone, which is the assertion that matters.
	 *
	 * A looser version of this test passed while the commit was quietly destroying the
	 * second span: it matched the span it had changed and never looked at its sibling. So
	 * the selection is placed deliberately over one span's contents rather than with
	 * select-all, which in a single field means all of it — as it does in any editor.
	 */
	await page.evaluate(() => {
		const doc = document.querySelector(`.board-node[data-path="boards/invented-fixture.html"] iframe`).contentDocument;
		const when = doc.querySelector("[data-id='rollout'] .phase .when");
		const range = doc.createRange();
		range.selectNodeContents(when);
		const selection = doc.defaultView.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
	});
	await page.keyboard.type("week 3");
	// Commit, not Escape: Escape is the cancel, and reverts to what the file said.
	await page.keyboard.press("ControlOrMeta+Enter");
	const retyped = await until(fixture, /week 3/);
	say(
		"retyping one span of the run keeps the other, and the markup around it",
		/<div class="phase"><span class="when">week 3<\/span><span>Lock behind a flag<\/span><\/div>/.test(retyped),
		retyped.split("\n").find((line) => line.includes("week 3"))?.trim(),
	);
	say(
		"and the retype touched one line and nothing else",
		retyped.split("\n").filter((line, index) => line !== swapped.split("\n")[index]).length === 1,
	);

	// --- the affordance, which is now inferred from the shape -------------------------

	/*
	 * Two plain strings out of the frame, not the rule: a `CSSStyleRule` does not survive
	 * Playwright's serialisation, and reading them here is what lets the assertion report
	 * the selector it was given when it fails.
	 *
	 * The selector was `[data-edit]:not([data-edit="false"]):hover` once, which could not lie
	 * because the attribute *was* the address; then `:not(:has(*))`, a leaf, which was right
	 * while only plain text could be retyped. It asks `:not(:has(:not(<inline tags>)))` now —
	 * no descendant that is not phrasing content — which is the same question the server asks
	 * of the parse tree before it will write a run back, off the same shared list.
	 */
	const rule = await frame()
		.locator("[data-id='rollout'] h3")
		.evaluate((el) => {
			// :hover cannot be forced from script, so ask the rule itself.
			const rules = [...el.ownerDocument.styleSheets].flatMap((sheet) => {
				try {
					return [...(sheet.cssRules ?? [])];
				} catch {
					return [];
				}
			});
			const found = rules.find((r) => r.selectorText?.includes(":not(:has(:not("));
			return { selector: found?.selectorText ?? "", decoration: found?.style?.textDecoration ?? "" };
		});
	say(
		"a run of words is underlined under the cursor, so you can see where to type",
		rule.selector.includes(":hover") && rule.decoration.includes("underline"),
		`${rule.selector.slice(0, 70)}… { text-decoration: ${rule.decoration} }`,
	);
	say(
		"…and it is the shape that is asked about, not an attribute somebody wrote",
		rule.selector.includes("[data-id]") &&
			rule.selector.includes(":not(:has(:not(") &&
			["b", "em", "span", "a"].every((tag) => rule.selector.includes(tag)),
		rule.selector.slice(0, 90),
	);

	/*
	 * The other half of the rule: a box holding other elements is not a leaf, so a
	 * plain-text replacement would throw them away. It refuses in the browser rather than
	 * sending a patch the server would refuse, and says which thing to aim at.
	 *
	 * The component's own padding is the target, above its heading. `.phase` is a grid whose
	 * two spans fill it exactly, so a row has no bare surface of its own to aim at — which
	 * is a fact about this fixture's CSS rather than about the rule.
	 */
	const before = read(fixture);
	await frame().locator("[data-id='rollout']").dblclick({ position: { x: 300, y: 4 } });
	await page.waitForTimeout(500);
	const notices = await page.locator(".notice").allTextContents();
	say(
		"a box holding other elements is not typed into, and says what to aim at instead",
		notices.some((text) => /Double-click the words themselves/.test(text)),
		notices.join(" | ") || "no notice",
	);
	await page.waitForTimeout(600);
	say("and the file is untouched by the attempt", read(fixture) === before);

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	rmSync(fixture, { force: true });
	await page.waitForTimeout(600);
	await browser.close();
}
