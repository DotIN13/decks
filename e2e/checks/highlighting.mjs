/**
 * Code on a board is coloured, from the board's own palette.
 *
 * This is the runtime's sixth renderer, and the only one whose output is *inside* an element
 * the file also wrote — a `pre` an agent typed is both the file's markup and the thing
 * `board.js` puts `hljs-*` spans into. So the check is about which blocks are claimed and
 * which are left alone, and about where the colours come from:
 *
 * - **a fenced block that names its language** (what an agent writes in a `[data-md]` panel)
 * - **a `pre` written into the file**, which no renderer has seen until the pass at the end
 *   of `start`
 * - **a source file an embed draws**, whose language comes from the file's extension
 * - **a fence with no language, and inline `code`**, which are left alone: the runtime never
 *   guesses, and a span put inside a run of words would be markup the run editor would
 *   faithfully spell back into the file
 *
 * The colours are then read out of the live element in both schemes, because "highlighted"
 * could be true and invisible: the two rules are that a keyword and a string differ, and that
 * both change when the reader's system does. `render-fidelity.mjs` is the check that says the
 * spans do not confuse the parse; this one says they are there and that they read.
 */
import { rmSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { WEB, deckState, flyToBoard, open, read, resetStage, say, settle, stagePath } from "../harness.mjs";

const deck = await deckState();
const fixture = `${deck.path}/boards/highlight-fixture.html`;
const sample = `${deck.path}/assets/highlight-sample.ts`;

/*
 * The source file the embed points at. Small, and with the four kinds of token the check
 * reads: a keyword, a string, a number and a comment.
 */
writeFileSync(
	sample,
	[
		"// What the highlighter is handed, as a file rather than a fence.",
		'export const name: string = "decks";',
		"export function double(value: number): number {",
		"\treturn value * 2;",
		"}",
		"",
	].join("\n"),
);

/*
 * One board, four shapes. The two markdown blocks are indented like the rest of the file
 * because a board is written that way — `dedent` in `board.js` is what makes that safe, and a
 * check on highlighting would notice if it stopped being.
 */
writeFileSync(
	fixture,
	`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Code fixture</title>
		<meta name="board" content='{"w":1160,"h":860,"bg":"grid"}' />
		<link rel="stylesheet" href="../lib/board.css" />
	</head>
	<body class="board">
		<div class="card" data-id="fenced" data-md style="left: 48px; top: 48px; width: 520px">
			## A fence that names its language

			\`\`\`ts
			export function double(value: number): number {
				// twice
				return value * 2;
			}
			\`\`\`
		</div>
		<section class="card" data-id="written" style="left: 600px; top: 48px; width: 520px">
			<h3>Written into the file</h3>
			<pre><code class="language-python">def double(value: int) -> int:
    # twice
    return value * 2
</code></pre>
		</section>
		<div class="card" data-id="unnamed" data-md style="left: 48px; top: 480px; width: 520px">
			## A fence with no language

			\`\`\`
			plain = nothing_highlighted
			\`\`\`

			Inline \`code\` stays plain as well.
		</div>
		<div class="embed" data-id="source" data-embed="../assets/highlight-sample.ts" style="left: 600px; top: 480px; width: 520px; height: 340px"></div>
		<script src="../lib/board.js"></script>
	</body>
</html>
`,
);

const browser = await chromium.launch();

try {
	const errors = [];
	const context = await browser.newContext({ viewport: { width: 1160, height: 860 } });
	const page = await context.newPage();
	page.on("pageerror", (error) => errors.push(error.message));

	await page.goto(`${WEB}/api/board/boards/highlight-fixture.html`, { waitUntil: "load" });
	await page.waitForFunction(() => window.__boardReady === true, null, { timeout: 15000 });

	/** What every `pre` on the board came out as, and the colours of one of them. */
	const readBoard = () =>
		page.evaluate(() => {
			const blocks = [...document.querySelectorAll("pre")].map((pre) => {
				const code = pre.firstElementChild?.tagName === "CODE" ? pre.firstElementChild : pre;
				const spans = [...code.querySelectorAll("span")];
				return {
					// Enough of it to say which block this is in a failure line, and to match on.
					text: (code.textContent ?? "").slice(0, 80),
					highlighted: code.classList.contains("hljs"),
					language: [...code.classList].find((name) => name.startsWith("language-")) ?? null,
					classes: [...new Set(spans.map((span) => span.className))],
					spans: spans.length,
				};
			});
			const colour = (selector) => {
				const el = document.querySelector(selector);
				return el ? getComputedStyle(el).color : null;
			};
			const inline = document.querySelector(".text code, p code");
			return {
				blocks,
				colours: {
					keyword: colour("pre code .hljs-keyword"),
					string: colour("pre code .hljs-string"),
					number: colour("pre code .hljs-number"),
					comment: colour("pre code .hljs-comment"),
				},
				inline: inline ? inline.classList.contains("hljs") : null,
				background: getComputedStyle(document.body).backgroundColor,
			};
		});

	await page.emulateMedia({ colorScheme: "light" });
	const light = await readBoard();
	await page.emulateMedia({ colorScheme: "dark" });
	const dark = await readBoard();

	const byText = (report, needle) => report.blocks.find((block) => block.text.includes(needle));
	const fenced = byText(light, "export function double");
	const written = byText(light, "def double(value: int)");
	const unnamed = byText(light, "plain = nothing_highlighted");
	const embedded = byText(light, "What the highlighter is handed");

	say(
		"a fenced block that names its language is coloured, and says which language",
		Boolean(fenced?.highlighted) && fenced?.language === "language-ts" && (fenced?.spans ?? 0) > 0,
		JSON.stringify(fenced),
	);
	say(
		"a `pre` written into the file is coloured the same way",
		Boolean(written?.highlighted) && written?.language === "language-python" && (written?.spans ?? 0) > 0,
		JSON.stringify(written),
	);
	say(
		"a source file an embed draws is coloured from its extension",
		Boolean(embedded?.highlighted) && embedded?.language === "language-typescript" && (embedded?.spans ?? 0) > 0,
		JSON.stringify(embedded),
	);
	say(
		"a fence with no language, and inline code, are left plain",
		Boolean(unnamed) && unnamed?.highlighted === false && unnamed?.spans === 0 && light.inline !== true,
		JSON.stringify({ unnamed, inline: light.inline }),
	);
	say(
		"a keyword and a string differ, in both schemes",
		light.colours.keyword !== light.colours.string && dark.colours.keyword !== dark.colours.string,
		`light ${light.colours.keyword} vs ${light.colours.string}; dark ${dark.colours.keyword} vs ${dark.colours.string}`,
	);
	say(
		"the colours are the board's own, so dark is a different palette",
		light.colours.keyword !== dark.colours.keyword &&
			light.background !== dark.background &&
			dark.colours.keyword !== null,
		`${light.colours.keyword} on ${light.background} → ${dark.colours.keyword} on ${dark.background}`,
	);
	say("four token families all resolved a colour", Object.values(dark.colours).every((value) => value !== null), JSON.stringify(dark.colours));
	say("no page errors while the board drew its code", errors.length === 0, errors.slice(0, 2).join(" | "));

	await context.close();

	/*
	 * --- the canvas's half --------------------------------------------------------
	 *
	 * A board's page is not edited from the canvas (15ef509c took the board editor out), so a
	 * double-click on a coloured `pre` must still open nothing: no run made editable, nothing
	 * written into the board's file, and the runtime's `hljs-*` spans left where they were.
	 */
	const app = await open({ width: 1440, height: 950, edit: true });
	try {
		await resetStage(app.page);
		await settle(app.page, 700);

		// Fly to the fixture, and zoom past the threshold below which a frame takes no pointer
		// events at all.
		await flyToBoard(app.page, "boards/highlight-fixture.html");
		await settle(app.page, 800);
		for (let attempt = 0; attempt < 8; attempt++) {
			const level = await app.page.evaluate(() =>
				Number((document.querySelector('.v3-zoom-value')?.textContent ?? "0%").replace(/[^0-9.]/g, "")),
			);
			if (level >= 70 && level <= 200) break;
			await app.page.keyboard.press(level < 70 ? "Control+Equal" : "Control+Minus");
			await settle(app.page, 250);
		}
		// On the canvas the fixture is the canvas's own copy, and that copy is the file a write would touch.
		const onStage = await stagePath(app.page, "boards/highlight-fixture.html");
		const frameSelector = `.board-node[data-path="${onStage}"] iframe`;
		const copy = `${deck.path}/${onStage}`;

		/** Whether anything in the frame became editable, and the spans still in the written block. */
		const state = () =>
			app.page.evaluate((selector) => {
				const win = document.querySelector(selector)?.contentWindow;
				const code = win?.document.querySelector('section[data-id="written"] pre code');
				return {
					editable: win ? [...win.document.querySelectorAll("[contenteditable]")].filter((el) => el.getAttribute("contenteditable") !== "false").length : -1,
					spans: code ? code.querySelectorAll("span").length : -1,
				};
			}, frameSelector);

		const before = read(copy);
		await app.page.frameLocator(frameSelector).locator('section[data-id="written"] pre code').dblclick();
		await settle(app.page, 400);
		const refused = await state();
		say("a double-click on a code block makes nothing editable", refused.editable === 0, JSON.stringify(refused));
		say(
			"…and writes nothing, and leaves the colours where the runtime put them",
			before !== undefined && read(copy) === before && refused.spans > 0,
			`${refused.spans} span(s) still in the block, file ${read(copy) === before ? "unchanged" : "changed"}`,
		);
		say("no page errors on the canvas either", app.errors.length === 0, app.errors.slice(0, 2).join(" | "));
	} finally {
		await app.browser.close();
	}
} finally {
	rmSync(fixture, { force: true });
	rmSync(sample, { force: true });
	await browser.close();
}
