import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cardShell } from "../cards/cards.ts";
import { STARTERS, writeStarter } from "./starters.ts";

test("every app starter fits a phone and a desktop: a viewport, a fluid column and a narrow-width rule", () => {
	const dir = mkdtempSync(join(tmpdir(), "starters-"));
	try {
		for (const starter of STARTERS) {
			const folder = join(dir, starter);
			const written = writeStarter(folder, starter, "Polls");
			const all = written.map((path) => readFileSync(join(folder, path), "utf8")).join("\n");
			assert.match(all, /width=device-width|width: "device-width"/, `${starter}: a viewport`);
			assert.match(all, /max-width: 960px; padding: clamp\(/, `${starter}: a fluid column`);
			assert.match(all, /@media \(max-width: 600px\)/, `${starter}: a narrow rule`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a new card starts fluid, with padding that shrinks and the card container named in an example", () => {
	const shell = cardShell("Sales", { w: 1000 });
	assert.match(shell, /\.doc \{ padding: clamp\(/);
	assert.match(shell, /max-width: 100%/);
	assert.match(shell, /@container card \(/);
});

test("the card's element is a size container named card, in board.css", () => {
	const css = readFileSync(new URL("../../../../packages/card-host/lib/board.css", import.meta.url), "utf8");
	assert.match(css, /body\.board \{[^}]*container: card \/ inline-size;/);
});
