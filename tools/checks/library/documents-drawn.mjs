/**
 * Documents draw as they did: the corpus in documents-drawn/ (every construct, the readers' edge cases,
 * a Google Doc, LaTeX numbering, three mounted pages) drawn through canvas/documents/drawn.ts and compared
 * with golden.json. DOCUMENTS_DRAWN_WRITE=1 writes the golden again: only on purpose, after the old code agrees.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { say } from "../harness.mjs";
import { corpus } from "./documents-drawn/items.mjs";

const folder = new URL("./documents-drawn/", import.meta.url).pathname;
const goldenFile = join(folder, "golden.json");
const scratch = mkdtempSync(join(tmpdir(), "documents-drawn-"));
await build({ entryPoints: [new URL("../../../canvas/documents/drawn.ts", import.meta.url).pathname], bundle: true, format: "iife", globalName: "DRAW", outfile: join(scratch, "draw.js"), logLevel: "warning" });

const items = corpus(folder);

const browser = await chromium.launch();
const page = await browser.newPage();
// A page of its own origin, so the page's storage (the PDF pane's saved width) can be read.
await page.route("http://drawn.test/", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
// A fixed day: \maketitle with no \date draws today's date, as LaTeX does.
await page.clock.setFixedTime(new Date("2026-11-15T12:00:00"));
await page.goto("http://drawn.test/");
await page.addScriptTag({ content: readFileSync(join(scratch, "draw.js"), "utf8") });
const drawn = {};
for (const item of items) drawn[item.name] = await page.evaluate((it) => globalThis.DRAW.drawItem(it), item);

if (process.env.DOCUMENTS_DRAWN_WRITE === "1") {
	writeFileSync(goldenFile, `${JSON.stringify(drawn, null, "\t")}\n`);
	say("the golden is written", true, `${items.length} items`);
} else {
	const golden = JSON.parse(readFileSync(goldenFile, "utf8"));
	say("the corpus is the golden's", items.every((it) => it.name in golden) && Object.keys(golden).length === items.length, Object.keys(golden).join(", "));
	for (const item of items) {
		const same = drawn[item.name] === golden[item.name];
		const lines = [(golden[item.name] ?? "").split("\n"), drawn[item.name].split("\n")];
		const line = lines[0].findIndex((text, n) => text !== lines[1][n]);
		const where = same ? "" : item.kind === "meta" || item.kind === "page" ? `line ${line}: was ${lines[0][line]?.slice(0, 160)} now ${lines[1][line]?.slice(0, 160)}` : await page.evaluate(([a, b]) => {
			const parse = (html) => Object.assign(document.createElement("div"), { innerHTML: html });
			const ea = [...parse(a).querySelectorAll("*")];
			const eb = [...parse(b).querySelectorAll("*")];
			for (let i = 0; i < Math.max(ea.length, eb.length); i++) if (ea[i]?.outerHTML !== eb[i]?.outerHTML) return `element ${i}: was ${ea[i]?.outerHTML.slice(0, 160)} now ${eb[i]?.outerHTML.slice(0, 160)}`;
			return "the text between elements";
		}, [golden[item.name] ?? "", drawn[item.name]]);
		say(`${item.name} draws as the golden says`, same, where);
	}
}
await browser.close();
rmSync(scratch, { recursive: true, force: true });
