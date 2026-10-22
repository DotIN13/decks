#!/usr/bin/env node
/**
 * Boards written with placed blocks (root-level children of `body.board`, each absolutely
 * positioned by `left`/`top`) become one flowing page.
 *
 *   node scripts/migrate-boards.mjs <deck> --old-lib <dir> --new-lib <dir> --out <dir> [--write] [--only <substring>]
 *
 * Each candidate board is opened in Chrome with the old `board.css`/`board.js` and every root
 * block measured where it sits. The blocks are then laid out again in the file's own source, in
 * rows: blocks whose heights overlap share a row, side by side at their measured widths and gaps,
 * and the rows stack with the gaps they had. Everything goes in one `<div class="flow">`, so the
 * page has a single root block and reads the same in the old runtime (one absolute block at the
 * corner) and the new one (it flows). The board is then opened again with the new lib, and both
 * pictures are kept under `--out`, with a report of how much each board changed.
 *
 * Without `--write` nothing in the deck changes. A board with one root block and no coordinates
 * already flows and is left alone.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "parse5";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flag = (name) => {
	const at = args.indexOf(name);
	return at === -1 ? undefined : args[at + 1];
};
const deck = args[0];
const oldLib = flag("--old-lib");
const newLib = flag("--new-lib");
const out = flag("--out");
const write = args.includes("--write");
const only = flag("--only");
if (!deck || !oldLib || !newLib || !out) {
	console.error("usage: migrate-boards.mjs <deck> --old-lib <dir> --new-lib <dir> --out <dir> [--write] [--only <substring>]");
	process.exit(2);
}
mkdirSync(out, { recursive: true });

const SKIP = new Set(["script", "style", "link", "template", "noscript", "#text", "#comment"]);
const isRoot = (node) => node.nodeName && !SKIP.has(node.nodeName) && !(node.nodeName === "svg" && node.attrs?.some((a) => a.name === "data-ink-layer"));
const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value;
const COORD = /(^|;)\s*(left|top|right|bottom)\s*:/i;

/** Every board file in the deck: `boards/` at the top and in each canvas. */
function boardFiles(root) {
	const found = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			if (name === "node_modules" || name === ".decks" || name === ".git" || name === "lib") continue;
			const path = join(dir, name);
			const st = statSync(path);
			if (st.isDirectory()) walk(path);
			else if (name.endsWith(".html") && /(^|\/)boards\//.test(relative(root, path))) found.push(path);
		}
	};
	walk(root);
	return found.sort();
}

/** The body's root blocks in the source, with where each starts and ends. */
function sourceRoots(html) {
	const doc = parse(html, { sourceCodeLocationInfo: true });
	const htmlEl = doc.childNodes.find((n) => n.nodeName === "html");
	const body = htmlEl?.childNodes.find((n) => n.nodeName === "body");
	if (!body) return undefined;
	const cls = attr(body, "class") ?? "";
	if (!cls.split(/\s+/).includes("board")) return undefined;
	return body.childNodes.filter(isRoot).map((node) => ({ node, start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset, startTag: node.sourceCodeLocation.startTag }));
}

/** A candidate: more than one root block, or one with coordinates of its own. */
function needsMigration(roots) {
	if (roots.length === 0) return false;
	if (roots.length > 1) return true;
	// One full-bleed block (a live doc, an app, a page) fills the board by its class now.
	const one = roots[0].node;
	if ((attr(one, "class") ?? "").split(/\s+/).includes("live") || attr(one, "data-bare") !== undefined || attr(one, "data-fill") !== undefined) return false;
	const style = attr(one, "style") ?? "";
	return COORD.test(style);
}

/** The start tag with this style, the old one's coordinates and position taken out. */
function restyle(tag, extra) {
	const m = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
	const kept = (m ? (m[2] ?? m[3] ?? "") : "")
		.split(";")
		.map((d) => d.trim())
		.filter((d) => d && !/^(left|top|right|bottom|position|width|margin|margin-left|margin-top|flex|align-self)\s*:/i.test(d));
	const style = [extra, ...kept].filter(Boolean).join("; ");
	if (m) return tag.slice(0, m.index) + ` style="${style.replace(/"/g, "&quot;")}"` + tag.slice(m.index + m[0].length);
	const close = tag.endsWith("/>") ? tag.length - 2 : tag.length - 1;
	return `${tag.slice(0, close)} style="${style.replace(/"/g, "&quot;")}"${tag.slice(close)}`;
}

/** The new source: the roots, in rows, inside one flowing block. */
function rebuild(html, roots, boxes) {
	const items = roots.map((r, i) => ({ ...r, box: boxes[i] })).sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
	const rows = [];
	for (const item of items) {
		const row = rows.at(-1);
		// Side by side only beside what is already in the row: a block over or under one of them
		// (they overlapped in the old page) goes on below instead.
		const clear = row?.items.every((other) => item.box.left >= other.box.left + other.box.width - 2 || item.box.left + item.box.width <= other.box.left + 2);
		if (row && clear && item.box.top < row.bottom - 4) {
			row.items.push(item);
			row.bottom = Math.max(row.bottom, item.box.top + item.box.height);
		} else rows.push({ top: item.box.top, bottom: item.box.top + item.box.height, items: [item] });
	}
	const indent = "\t\t";
	let lastBottom = 0;
	const parts = rows.map((row) => {
		row.items.sort((a, b) => a.box.left - b.box.left);
		const gap = Math.max(0, Math.round(row.top - lastBottom));
		lastBottom = Math.max(lastBottom, row.bottom);
		let right = 0;
		const blocks = row.items.map((item) => {
			const b = item.box;
			const ml = Math.round(b.left - right);
			right = Math.max(right, b.left + b.width);
			const mt = Math.round(b.top - row.top);
			const extra = `position: static; flex: none; width: ${Math.round(b.width)}px; margin: ${mt}px 0 0 ${ml}px`;
			const tagText = html.slice(item.startTag.startOffset, item.startTag.endOffset);
			return indent + "\t" + restyle(tagText, extra) + html.slice(item.startTag.endOffset, item.end);
		});
		return `${indent}<div class="flow-row" style="display: flex; align-items: flex-start; margin-top: ${gap}px">\n${blocks.join("\n")}\n${indent}</div>`;
	});
	const wrapper = `<div class="flow" data-id="page" data-migrated="placed" style="position: static; width: 100%">\n${parts.join("\n")}\n\t</div>`;
	// Cut every root out, last first, and put the wrapper where the first one was.
	const byStart = [...roots].sort((a, b) => a.start - b.start);
	let text = html;
	for (let i = byStart.length - 1; i >= 0; i--) {
		const r = byStart[i];
		const next = i === 0 ? wrapper : "";
		let end = r.end;
		if (i !== 0) while (text[end] === "\n" || text[end] === "\t" || text[end] === " ") end++;
		text = text.slice(0, r.start) + next + text.slice(end);
	}
	// A board's own rules that named the body's children now name the wrapper's.
	text = text.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, open, css, close) => open + css.replace(/((?:body)?\.board)\s*>\s*(?=[.#\w\[*:])/g, "$1 .flow-row > ") + close);
	return text;
}

const libRoute = (dir) => async (route) => {
	const url = new URL(route.request().url());
	const m = /\/lib\/(?:~[^/]+\/)?(.+)$/.exec(url.pathname);
	const file = m && join(dir, decodeURIComponent(m[1]));
	if (file && existsSync(file)) return route.fulfill({ path: file });
	return route.continue();
};

async function render(page, file, lib, html) {
	await page.unroute("**/*");
	await page.route(/\/lib\//, libRoute(lib));
	const url = pathToFileURL(file).href;
	if (html !== undefined) await page.route(url, (route) => route.fulfill({ body: html, contentType: "text/html" }));
	await page.goto(url, { waitUntil: "load", timeout: 20000 }).catch(() => {});
	await page.evaluate(() => document.fonts?.ready).catch(() => {});
	await page.waitForTimeout(600);
}

const metaWidth = (html) => {
	const m = /<meta\s+name=["']board["']\s+content='([^']*)'/i.exec(html) ?? /<meta\s+name=["']board["']\s+content="([^"]*)"/i.exec(html);
	try {
		const w = Number(JSON.parse(m?.[1]?.replace(/&quot;/g, '"') ?? "{}").w);
		return Number.isFinite(w) && w > 0 ? w : 1200;
	} catch {
		return 1200;
	}
};

const files = boardFiles(deck).filter((f) => !only || f.includes(only));
const report = { deck, write, at: new Date().toISOString(), total: files.length, unchanged: 0, migrated: [], skipped: [] };
const browser = await chromium.launch({ channel: "chrome", args: ["--allow-file-access-from-files"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
let n = 0;
for (const file of files) {
	const rel = relative(deck, file);
	const html = readFileSync(file, "utf8");
	let roots;
	try {
		roots = sourceRoots(html);
	} catch (error) {
		report.skipped.push({ board: rel, why: `does not parse: ${error.message}` });
		continue;
	}
	if (!roots || !needsMigration(roots)) {
		report.unchanged++;
		continue;
	}
	const width = metaWidth(html);
	await page.setViewportSize({ width, height: 900 });
	await render(page, file, oldLib);
	const boxes = await page.evaluate(() => {
		const skip = new Set(["SCRIPT", "STYLE", "LINK", "TEMPLATE", "NOSCRIPT"]);
		const body = document.body.getBoundingClientRect();
		return [...document.body.children]
			.filter((el) => !skip.has(el.tagName) && !(el.tagName.toLowerCase() === "svg" && el.hasAttribute("data-ink-layer")) && !el.hasAttribute("data-decks-runtime"))
			.map((el) => {
				const r = el.getBoundingClientRect();
				return { tag: el.tagName.toLowerCase(), id: el.getAttribute("data-id"), left: r.left - body.left, top: r.top - body.top, width: r.width, height: r.height };
			});
	});
	const sourceTags = roots.map((r) => r.node.nodeName);
	const pageTags = boxes.map((b) => b.tag);
	if (sourceTags.join(",") !== pageTags.slice(0, sourceTags.length).join(",") || boxes.length < roots.length) {
		report.skipped.push({ board: rel, why: `its root blocks in the page (${pageTags.join(",")}) do not match the file (${sourceTags.join(",")})` });
		continue;
	}
	const slug = `${String(++n).padStart(3, "0")}-${basename(file, ".html").slice(0, 40)}`;
	await page.screenshot({ path: join(out, `${slug}.before.jpg`), fullPage: true, type: "jpeg", quality: 70 });
	const next = rebuild(html, roots, boxes.slice(0, roots.length));
	await render(page, file, newLib, next);
	await page.screenshot({ path: join(out, `${slug}.after.jpg`), fullPage: true, type: "jpeg", quality: 70 });
	const height = await page.evaluate(() => document.documentElement.scrollHeight);
	if (write) writeFileSync(file, next);
	else writeFileSync(join(out, `${slug}.html`), next);
	report.migrated.push({ board: rel, slug, blocks: roots.length, rows: next.split('class="flow-row"').length - 1, width, height });
	process.stdout.write(`${report.migrated.length} ${rel}\n`);
}
await browser.close();
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
console.log(`${report.migrated.length} migrated, ${report.unchanged} already flowing, ${report.skipped.length} skipped${write ? "" : " (dry run: nothing in the deck changed)"}`);
