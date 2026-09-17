import assert from "node:assert/strict";
import { test } from "node:test";
import { bindings, codeFor, triggers } from "./eval-code.ts";

/**
 * The extractor against the shapes a board actually arrives in.
 *
 * Every case here is one an agent's own writing produces or a person's editor does: the
 * attributes in either order, either quote, a script with no `data-for`, a component that
 * names a script nobody wrote. The one thing that is *not* tested is a script hidden in a
 * string, because that is the case this deliberately reads as markup rather than as code.
 */

const BOARD = `<!doctype html>
<html>
	<head><title>Promote</title></head>
	<body class="board">
		<button data-id="promote" data-eval="pick" data-value="round-20">Promote</button>
		<div class="card" data-id="note">Choose one</div>
		<select data-id="arm" data-eval="choose"><option>a</option></select>
		<script type="text/decks-eval" data-for="pick">
			await stage.send("Kestrel", { task: \`Promote \${event.value}\`, boards: [event.board] });
		</script>
		<script data-for="choose" type='text/decks-eval'>await stage.show(event.board);</script>
	</body>
</html>
`;

test("both attribute orders and both quotes are read", () => {
	const found = bindings(BOARD);
	assert.deepEqual(
		found.map((binding) => binding.id),
		["pick", "choose"],
	);
	assert.match(found[0]!.code, /stage\.send\("Kestrel"/);
	assert.match(found[1]!.code, /stage\.show\(event\.board\)/);
});

test("a script of another type is not code a board may run", () => {
	const html = `<script type="text/javascript" data-for="go">alert(1)</script>`;
	assert.deepEqual(bindings(html), []);
});

test("a script with no data-for answers nothing", () => {
	const html = `<script type="text/decks-eval">await stage.toast("hi");</script>`;
	assert.deepEqual(bindings(html), []);
	assert.equal(codeFor(html, "anything"), undefined);
});

test("the case of the type is not the board's problem", () => {
	const html = `<script TYPE="Text/Decks-Eval" data-for="go">1</script>`;
	assert.equal(codeFor(html, "go"), "1");
});

test("an id named twice keeps both, and the first is the one that runs", () => {
	const html = `<script type="text/decks-eval" data-for="go">first</script>
		<script type="text/decks-eval" data-for="go">second</script>`;
	assert.deepEqual(bindings(html).map((binding) => binding.code), ["first", "second"]);
	assert.equal(codeFor(html, "go"), "first");
});

test("triggers come from the components, in order, without repeats", () => {
	assert.deepEqual(triggers(BOARD), ["pick", "choose"]);
});

test("a trigger no script answers is still reported", () => {
	const html = `<button data-id="go" data-eval="missing">Go</button>`;
	assert.deepEqual(triggers(html), ["missing"]);
	assert.equal(codeFor(html, "missing"), undefined);
});

test("a component with other attributes around data-eval is read", () => {
	const html = `<button class="chip" data-value="x" data-eval="run" data-id="go" type="button">Go</button>`;
	assert.deepEqual(triggers(html), ["run"]);
});

test("a board with no eval at all is empty rather than broken", () => {
	assert.deepEqual(bindings("<body class=\"board\"><p>hi</p></body>"), []);
	assert.deepEqual(triggers("<body class=\"board\"><p>hi</p></body>"), []);
});
