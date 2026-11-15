import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TAB_RELAY_PATH } from "../../protocol/index.ts";

// The extension is plain JavaScript Chrome loads as it is, so it cannot
// import the protocol; these checks hold its names to the protocol's.

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

test("the extension dials the relay path the protocol names", () => {
	assert.ok(read("./background.js").includes(`url.pathname = "${TAB_RELAY_PATH}";`));
});

test("the manifest is Manifest V3 with a module service worker and the popup", () => {
	const manifest = JSON.parse(read("./manifest.json")) as { manifest_version: number; background: { service_worker: string; type: string }; action: { default_popup: string } };
	assert.equal(manifest.manifest_version, 3);
	assert.deepEqual(manifest.background, { service_worker: "background.js", type: "module" });
	assert.equal(manifest.action.default_popup, "popup.html");
});

test("every module the worker loads is in the folder", () => {
	const imports = ["background.js", "group.js", "relay.js"].flatMap((file) => [...read(`./${file}`).matchAll(/from "\.\/([\w.-]+)"/g)].map((m) => m[1]!));
	for (const name of imports) assert.ok(read(`./${name}`).length > 0, name);
});
