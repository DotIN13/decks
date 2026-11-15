import assert from "node:assert/strict";
import { test } from "node:test";
import { searchIcons } from "./icon-index.ts";

const icons = [
	{ name: "database", tags: ["storage", "memory"] },
	{ name: "database-backup", tags: ["storage", "restore"] },
	{ name: "hard-drive", tags: ["storage", "computer"] },
	{ name: "cloud", tags: ["weather"] },
	{ name: "cloud-upload", tags: ["upload", "storage"] },
];

test("an icon search puts the name asked for first, then names starting with it, then tags", () => {
	assert.deepEqual(searchIcons(icons, "database").map((one) => one.name), ["database", "database-backup"]);
	assert.deepEqual(searchIcons(icons, "storage").map((one) => one.name).sort(), ["cloud-upload", "database", "database-backup", "hard-drive"]);
});

test("every word of a search has to be found, in the name or the tags", () => {
	assert.deepEqual(searchIcons(icons, "cloud upload").map((one) => one.name), ["cloud-upload"]);
	assert.deepEqual(searchIcons(icons, "cloud rain"), []);
	assert.equal(searchIcons(icons, "").length, icons.length);
});
