import assert from "node:assert/strict";
import { test } from "node:test";
import { GUEST_SCRIPT, guestScript, withGuest } from "./canvas-guest.ts";

test("a page opened in the canvas frame gets the canvas guest first, unless it has it", () => {
	const page = "<!doctype html><html><head><title>x</title></head><body></body></html>";
	const given = withGuest(page, `/app/t/pass/x/${GUEST_SCRIPT}`);
	assert.ok(given.startsWith(`<!doctype html><html><head><script src="/app/t/pass/x/${GUEST_SCRIPT}"></script><title>`));
	assert.equal(withGuest(given, `/app/t/pass/x/${GUEST_SCRIPT}`), given, "a page that has it keeps the one it has");
	assert.ok(withGuest("<p>bare</p>", "g.js").startsWith('<script src="g.js"></script>'), "a page with no head gets it first");
});

test("a page that asks for the storage stand-in by its old name gets no second tag", () => {
	const own = `<head><script src="decks-storage.js"></script></head>`;
	assert.equal(withGuest(own, "/app/t/PASS/x/decks-canvas.js"), own);
});

test("the guest stands in for localStorage, and hands a wheel the page cannot use up to the canvas", () => {
	const script = guestScript("x");
	assert.ok(script.includes('"decks-storage"'));
	assert.ok(script.includes('"localStorage"'));
	assert.ok(script.includes('"decks-wheel"'));
	assert.ok(script.includes("scrollsInside"));
	assert.ok(script.includes("window.parent === window"), "a tab of its own keeps every wheel");
});
