import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { libName, servedAs } from "../deck/layout.ts";
import { deckVersion, DryRun, LATEST, MIGRATIONS, runAtOpen } from "./index.ts";
import { readRecord } from "./version.ts";

/*
 * The upgrade guarantee: a deck kept the way it was around 2026-10-15, before deck versions, before
 * canvases stood alone and before boards became cards, still opens on today's code and ends at the
 * latest version, through the same `runAtOpen` a starting server calls (`App.open`).
 *
 * The fixture (`fixtures/old-deck/`) is the install's data folder: `board-eval.json` (the Allow
 * decisions) beside the deck in `decks/`. The deck keeps its canvases in `stages/<agent>/stage.pen`
 * and its boards in the library `boards/`, placed by deck path, with: a board with a script and a
 * `data-eval` button, a board placed on two stages, a board measured taller than its item
 * (`heights.json`), a document board, an app board, a file board, the shared Chrome tab's board, a page
 * framing a site (with its last picture), a document board inside a frame, a board kept in a stage's
 * own folder, a markdown card, a board on no stage, an isolated agent, and a friend's shared canvas
 * with a board of its own. The repo ignores `.decks/`, so the deck's is kept as `dot-decks/` and
 * renamed when it is copied.
 */
const FIXTURE = fileURLToPath(new URL("./fixtures/old-deck", import.meta.url));

function copyFixture(): { data: string; deck: string } {
	const data = realpathSync(mkdtempSync(join(tmpdir(), "decks-old-deck-")));
	cpSync(FIXTURE, data, { recursive: true });
	const deck = join(data, "decks");
	renameSync(join(deck, "dot-decks"), join(deck, ".decks"));
	return { data, deck };
}

/** Every file under a folder, by its path (posix) → a hash of its bytes. */
function snapshot(dir: string): Map<string, string> {
	const out = new Map<string, string>();
	const visit = (at: string) => {
		for (const entry of readdirSync(at, { withFileTypes: true })) {
			const full = join(at, entry.name);
			if (entry.isDirectory()) visit(full);
			else out.set(relative(dir, full).split(sep).join("/"), createHash("sha1").update(readFileSync(full)).digest("hex"));
		}
	};
	if (existsSync(dir)) visit(dir);
	return out;
}

interface Item {
	type?: string;
	id?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	url?: string;
	metadata?: { type?: string; path?: string; name?: string; [key: string]: unknown };
	children?: Item[];
	[key: string]: unknown;
}

const json = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
function* items(list: Item[] | undefined): Generator<Item> {
	for (const one of list ?? []) {
		yield one;
		yield* items(one.children);
	}
}
const drawing = (deck: string, canvas: string) => json<{ children: Item[] }>(join(deck, "canvases", canvas, "canvas.pen"));
const byId = (deck: string, canvas: string) => new Map([...items(drawing(deck, canvas).children)].map((one) => [one.id, one]));

/** The relative addresses a page's `href` and `src` name, as deck paths read from the page's folder. */
function addressesIn(deck: string, page: string): string[] {
	const html = readFileSync(join(deck, page), "utf8");
	const out: string[] = [];
	for (const match of html.matchAll(/\b(?:href|src)\s*=\s*["']([^"'#?:]+)["']/gi)) {
		const address = match[1]!;
		if (address.startsWith("/")) continue;
		out.push(posix.normalize(posix.join(posix.dirname(page), address)));
	}
	return out;
}

/** Whether a deck path is served as a file the deck has (`servedAs`, which maps a canvas's lib/, assets/, docs/ to the deck's). */
function serves(deck: string, path: string): boolean {
	const served = servedAs(path);
	return "path" in served && existsSync(join(deck, served.path));
}

test("an old deck (stages/, library boards, no version) migrates all the way to the latest version on today's code", () => {
	const { data, deck } = copyFixture();
	try {
		const friendBefore = snapshot(join(deck, "shared"));
		assert.equal(deckVersion(deck), "0.0.0", "a deck from before versions and before canvases is at none");

		const said = runAtOpen(deck, { dataDir: data });

		// The version, and every migration that records itself recorded.
		assert.equal(deckVersion(deck), LATEST);
		const record = readRecord(deck);
		assert.equal(record.version, LATEST);
		for (const one of MIGRATIONS) if (one.migrated) assert.ok(one.id in record, `${one.id} recorded itself`);
		assert.ok(said.some((line) => /boards are cards now/.test(line)), said.join("\n"));
		assert.ok(said.some((line) => /the last boards on the canvases are gone/.test(line)), said.join("\n"));

		// Stages became canvases, named for their titles; an untitled one keeps its folder, as provisional.
		assert.ok(!existsSync(join(deck, "stages")));
		assert.deepEqual(readdirSync(join(deck, "canvases")).sort(), ["auth-refresh", "wren"]);
		assert.equal(json<{ title: string }>(join(deck, "canvases", "auth-refresh", "canvas.json")).title, "Auth refresh");
		assert.equal(json<{ provisional?: boolean }>(join(deck, "canvases", "wren", "canvas.json")).provisional, true);

		// What each board on the deck's own canvases became.
		const auth = byId(deck, "auth-refresh");
		const card = (canvas: string, id: string, name: string) => {
			const item = byId(deck, canvas).get(id);
			assert.equal(item?.metadata?.type, "decks.card", `${canvas}/${id} is a card`);
			assert.equal(item?.metadata?.path, `cards/${name}/index.html`);
			assert.ok(existsSync(join(deck, "canvases", canvas, "cards", name, "index.html")), `${canvas}/cards/${name} was written`);
			return readFileSync(join(deck, "canvases", canvas, "cards", name, "index.html"), "utf8");
		};
		// The board with a script and a data-eval button: a card whose script is a module and whose button still answers.
		const plan = card("auth-refresh", "plan", "plan");
		assert.match(plan, /export default async function \(card\)/, "its inline script is a module called with the card");
		assert.match(plan, /"ship": async \(stage, event\)/, "its data-eval block is wired");
		assert.match(plan, /send: "agent\.queue"/, "stage.send is mapped to the card's call");
		assert.doesNotMatch(plan, /board\.(css|js)/, "board.css and board.js are the card's already, and dropped");
		assert.match(plan, /href="\.\.\/risks\/index\.html"/, "a link to a board that became a card points at the card");
		const planAddresses = addressesIn(deck, "canvases/auth-refresh/cards/plan/index.html");
		assert.ok(planAddresses.includes("boards/free.html") && existsSync(join(deck, "boards", "free.html")), "a link to a library board on no canvas reaches it");
		assert.ok(planAddresses.includes("canvases/auth-refresh/files/chart.svg") && existsSync(join(deck, "canvases/auth-refresh/files/chart.svg")), "its picture came into the canvas's files/");
		card("auth-refresh", "risks", "risks");
		card("auth-refresh", "notes", "notes");
		assert.equal(auth.get("notes")?.height, 1800, "a card is as tall as its board's page last measured (heights.json), not its item's 240");
		// The document and app boards: items.
		const paper = auth.get("paper")!;
		assert.equal(paper.metadata?.type, "decks.document");
		assert.ok(paper.metadata?.path && serves(deck, paper.metadata.path), `the document item's file is served: ${paper.metadata?.path}`);
		assert.deepEqual([paper.x, paper.y, paper.width, paper.height], [0, 800, 800, 900], "an item keeps its place and size");
		assert.deepEqual(auth.get("review")?.metadata, { type: "decks.app", name: "review" });
		const pinned = auth.get("pinned")!;
		assert.equal(pinned.metadata?.type, "decks.document", "a document board inside a frame becomes one too");
		assert.ok(drawing(deck, "auth-refresh").children.find((one) => one.id === "group")?.children?.some((one) => one.id === "pinned"), "and stays in its frame");
		// The file board: a file card keeping its id and place.
		const pdf = auth.get("pdf")!;
		assert.equal(pdf.type, "frame");
		assert.equal(pdf.metadata?.type, "decks.file");
		assert.equal(pdf.metadata?.path, "files/papers/sample.pdf");
		assert.ok(existsSync(join(deck, "canvases", "auth-refresh", "files", "papers", "sample.pdf")));
		assert.deepEqual([pdf.x, pdf.y], [0, 1800]);
		// The shared Chrome tab's board: removed.
		assert.ok(!auth.has("chrome"));
		// A page framing a site: a card of its last picture, with a link to the old page, which stays.
		const site = card("auth-refresh", "site", "embed-site");
		assert.ok(existsSync(join(deck, "canvases", "auth-refresh", "cards", "embed-site", "picture.webp")), "the board's last picture is copied into the card");
		assert.ok(addressesIn(deck, "canvases/auth-refresh/cards/embed-site/index.html").includes("canvases/auth-refresh/boards/embed-site.html"));
		assert.ok(existsSync(join(deck, "canvases", "auth-refresh", "boards", "embed-site.html")), "the old page a picture card opens is kept");
		assert.match(site, /Open the old board/);
		// The markdown card, the text and the arrow.
		assert.equal(auth.get("md")?.metadata?.type, "decks.markdown-card");
		assert.equal(auth.get("label")?.type, "text");
		assert.deepEqual(auth.get("arrow")?.source, { id: "plan" }, "an arrow still joins the ids it joined");
		// The other canvas: the board placed on both stages, and the one kept in the stage's own folder.
		card("wren", "risks", "risks");
		card("wren", "kept", "kept");

		// Nothing on the deck's own canvases is a board any more, and no board file is left but the one a picture card opens.
		for (const canvas of readdirSync(join(deck, "canvases"))) {
			for (const item of items(drawing(deck, canvas).children)) assert.notEqual(item.metadata?.type, "decks.board", `canvases/${canvas}: ${item.id} is still a board`);
		}
		const leftBoards = [...snapshot(join(deck, "canvases")).keys()].filter((path) => /^[^/]+\/boards\//.test(path));
		assert.deepEqual(leftBoards, ["auth-refresh/boards/embed-site.html"]);
		// The library: what no stage placed stays; the app's board stays the app's; boards moved out are gone.
		assert.deepEqual([...snapshot(join(deck, "boards")).keys()].sort(), ["apps/review.html", "free.html"]);

		// A friend's canvas is theirs: byte for byte, and still a board.
		assert.deepEqual(snapshot(join(deck, "shared")), friendBefore);

		// The records followed: the agent is ordinary, on the renamed canvas; Allow decisions follow the board.
		const agent = json<Record<string, unknown>>(join(deck, ".decks", "agents", "a1", "meta.json"));
		assert.equal(agent.stage, "auth-refresh");
		assert.ok(!("isolated" in agent) && !("isolatedStages" in agent));
		assert.deepEqual(agent.context, ["canvases/auth-refresh/boards/plan.html", "canvases/auth-refresh/boards/risks.html"]);
		assert.ok(json<{ allowed: string[] }>(join(data, "board-eval.json")).allowed.includes("canvases/auth-refresh/boards/plan.html"));

		// Backups before every migration that changes something, each a zip that reads, and the leftovers' report.
		const backups = readdirSync(join(deck, ".decks", "backups"));
		for (const kind of ["standalone-canvases", "isolation-removed", "markdown-cards", "documents-and-apps", "boards-to-cards", "board-leftovers"]) {
			const zip = backups.find((name) => name.endsWith(`-before-${kind}.zip`));
			assert.ok(zip, `a backup before ${kind}: ${backups.join(", ")}`);
			assert.ok(statSync(join(deck, ".decks", "backups", zip)).size > 0);
			execFileSync("unzip", ["-tq", join(deck, ".decks", "backups", zip)], { stdio: "ignore" });
		}
		const report = backups.find((name) => name.endsWith("-board-leftovers.txt"));
		assert.ok(report, "the leftovers wrote a report");
		const text = readFileSync(join(deck, ".decks", "backups", report), "utf8");
		assert.match(text, /your-chrome\.html \(chrome\) -> removed/);
		assert.match(text, /embed-site\.html \(site\) -> picture card cards\/embed-site: its page frames another page/);
		assert.match(text, /sample-pdf\.html \(pdf\) -> file card for files\/papers\/sample\.pdf/);
		const leftovers = record["2026-10-30-board-leftovers"] as { notConverted: Array<{ board: string; as: string }>; backup: string; report: string };
		assert.deepEqual(leftovers.notConverted.map((one) => [one.board, one.as]), [["canvases/auth-refresh/boards/embed-site.html", "picture"]]);
		assert.equal(leftovers.report, `.decks/backups/${report}`);

		// What the converted cards and the kept page ask for is served: an old page's ../lib/board.css is lib/card.css.
		assert.equal(libName("board.css"), "card.css");
		assert.equal(libName("board.js"), "card.js");
		assert.equal(libName("~ab12/board.css"), "~ab12/card.css");
		assert.deepEqual(servedAs("canvases/auth-refresh/lib/board.js"), { path: "lib/card.js" });
		let libAsks = 0;
		for (const canvas of readdirSync(join(deck, "canvases"))) {
			const pages = [...snapshot(join(deck, "canvases", canvas)).keys()].filter((path) => /^(cards\/[^/]+\/index|boards\/.+)\.html$/.test(path)).map((path) => `canvases/${canvas}/${path}`);
			for (const page of pages) {
				for (const address of addressesIn(deck, page)) {
					if (!/^canvases\/[^/]+\/lib\//.test(address)) continue;
					libAsks += 1;
					const served = servedAs(address);
					assert.ok("path" in served, `${page} asks for ${address}, which is refused`);
					const file = posix.basename(address);
					if (/^board\.(css|js)$/.test(file)) assert.equal(served.path, `lib/${libName(file)}`, `${page}: ${address} is served as the card runtime`);
				}
			}
		}
		assert.ok(libAsks > 0, "the kept old page asks for ../lib/board.css, and it was checked");

		// Running again changes nothing.
		const after = snapshot(data);
		assert.deepEqual(runAtOpen(deck, { dataDir: data }), []);
		assert.deepEqual(snapshot(data), after);
	} finally {
		rmSync(data, { recursive: true, force: true });
	}
});

test("a dry run on the old deck says it is at none, with every migration to run, and writes nothing", () => {
	const { data, deck } = copyFixture();
	try {
		const before = snapshot(data);
		assert.throws(
			() => runAtOpen(deck, { dataDir: data, dryRun: true }),
			(error: unknown) => error instanceof DryRun && error.lines.some((line) => line.includes(`is at version 0.0.0; ${MIGRATIONS.length} migration(s) would run, to version ${LATEST}`)),
		);
		assert.deepEqual(snapshot(data), before);
	} finally {
		rmSync(data, { recursive: true, force: true });
	}
});
