import assert from "node:assert/strict";
import { test } from "node:test";
import { beginScrub, cancelScrub, commitScrub, moveScrub, scrubValue } from "./scrub.ts";

/*
 * No DOM anywhere in this file, and that is the point of `scrub.ts` being split the way it
 * is. Everything worth checking about a scrub — what a modifier is worth, what the number
 * rounds to, what Escape leaves behind, and whether a release writes anything — is
 * arithmetic over a plain object.
 */

test("a pixel of drag is a unit, ⇧ is ten of them and ⌥ is a tenth", () => {
	// The three multipliers from `boards/the-inspector-a-real-properties-panel`: 1px per
	// pixel, ⇧ for 10, ⌥ for 0.1.
	assert.equal(scrubValue(560, 24), 584);
	assert.equal(scrubValue(560, -24), 536);
	assert.equal(scrubValue(560, 24, { shift: true }), 800);
	assert.equal(scrubValue(560, -24, { shift: true }), 320);

	/*
	 * ⌥ on a field whose step is 1 is *ten pixels of travel per unit*, not a fractional
	 * pixel — the step rounding turns the finer unit into finer control, which is what the
	 * modifier is for. A CSS pixel in an HTML file is an integer, and the server rounds one
	 * on the way in, so a field that committed 560.4 would read back 560.
	 */
	assert.equal(scrubValue(560, 4, { alt: true }), 560);
	assert.equal(scrubValue(560, 5, { alt: true }), 561);
	assert.equal(scrubValue(560, 24, { alt: true }), 562);
	assert.equal(scrubValue(560, -24, { alt: true }), 558);

	// Both held: ⇧ is the coarse one and it wins. Two multipliers at once is not a third
	// speed anybody could aim.
	assert.equal(scrubValue(560, 3, { shift: true, alt: true }), 590);
});

test("the value lands on the field's own step, and ⇧ does not snap to an absolute grid", () => {
	// A step of 8 is the grid the drags snap to: every value is a multiple of it *relative
	// to where the drag started*, which for a component already on the grid is the grid.
	assert.equal(scrubValue(48, 3, {}, { step: 8 }), 72);
	assert.equal(scrubValue(48, 3, { shift: true }, { step: 8 }), 288);

	/*
	 * The invariant that rules absolute snapping out. `Math.round(value / 10) * 10` under ⇧
	 * would be tidier and would move 824 to 820 for a drag that went nowhere — so releasing
	 * the pointer where you pressed it would write a revision.
	 */
	assert.equal(scrubValue(824, 0, { shift: true }), 824);
	assert.equal(scrubValue(824, 1, { shift: true }), 834);

	// Fractional pointer coordinates on a HiDPI screen are whole pixels of drag, so the
	// number does not jitter under a still hand.
	assert.equal(scrubValue(100, 0.4), 100);
	assert.equal(scrubValue(100, 1.6), 102);

	// A fractional step comes out clean: 0.1 arithmetic in binary floats otherwise carries
	// dust like 10.300000000000001 into the file.
	assert.equal(scrubValue(10, 3, {}, { step: 0.1 }), 10.3);
	assert.equal(scrubValue(10, 3, { shift: true }, { step: 0.1 }), 13);
});

test("clamping is the field's, not the drag's", () => {
	// You cannot pull a component off the top-left of its own board, and a width of zero is
	// a component nobody can find again.
	assert.equal(scrubValue(10, -400, {}, { min: 0 }), 0);
	assert.equal(scrubValue(40, -400, {}, { min: 8 }), 8);
	assert.equal(scrubValue(1900, 400, {}, { max: 1920 }), 1920);
	// And a clamp does not stop the drag: coming back off the wall reads normally, because
	// the value is computed from where the pointer *is* rather than accumulated per event.
	const drag = beginScrub(10, 500);
	assert.equal(moveScrub(drag, 100, {}, { min: 0 }), true);
	assert.equal(drag.value, 0);
	assert.equal(moveScrub(drag, 505, {}, { min: 0 }), true);
	assert.equal(drag.value, 15);
});

test("a drag of zero pixels commits nothing", () => {
	// A click on the label. One patch is one revision and the revision list is the undo
	// history, so a click that writes the number the file already holds is a wasted entry.
	const drag = beginScrub(824, 300);
	assert.equal(moveScrub(drag, 300, {}), false);
	assert.equal(commitScrub(drag), undefined);

	// And a drag that wandered and came back is the same thing: what commits is the
	// difference between the ends, not the distance travelled.
	assert.equal(moveScrub(drag, 340, {}), true);
	assert.equal(drag.value, 864);
	assert.equal(moveScrub(drag, 300, {}), true);
	assert.equal(drag.value, 824);
	assert.equal(commitScrub(drag), undefined);
});

test("one commit for a whole drag, carrying only the value it ended on", () => {
	const drag = beginScrub(560, 200);
	const previews: number[] = [];
	for (const x of [201, 201, 204, 240]) {
		if (moveScrub(drag, x, {})) previews.push(drag.value);
	}
	// The repeat is not a preview: under ⌥ most moves land on the same number, and
	// re-writing the same `style.left` invalidates the board's layout for nothing.
	assert.deepEqual(previews, [561, 564, 600]);
	assert.equal(commitScrub(drag), 600);
});

test("Escape puts the number back and leaves nothing to write", () => {
	const drag = beginScrub(824, 300);
	moveScrub(drag, 380, {});
	assert.equal(drag.value, 904);

	// The value the caller previews to put the board back where it was.
	assert.equal(cancelScrub(drag), 824);
	assert.equal(drag.value, 824);
	assert.equal(commitScrub(drag), undefined);

	// A cancelled drag is over, even though the pointer is still down: the modifier keys
	// and any further movement do not restart it.
	assert.equal(moveScrub(drag, 500, { shift: true }), false);
	assert.equal(drag.value, 824);
	assert.equal(commitScrub(drag), undefined);
});
