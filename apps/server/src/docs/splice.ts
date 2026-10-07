import { applySplice, transformSplice, type Splice } from "@decks/protocol";

export { applySplice };
import { diffArrays } from "diff";

/**
 * Splices: landing a page's edits on a text that may have moved since the page saw it, and
 * turning one text into another as splices.
 *
 * Pure functions over strings, so the whole of the merge rule can be tested without a file.
 */

/** Apply sequential splices, each checked; throws on the first whose `before` is not there. */
export function applySplices(text: string, splices: readonly Splice[]): string {
	let out = text;
	for (const splice of splices) {
		if (out.slice(splice.at, splice.at + splice.before.length) !== splice.before) throw new Error(`Splice at ${splice.at} does not match the text`);
		out = applySplice(out, splice);
	}
	return out;
}

/** The shared rule (`@decks/protocol`), named here as the tests and `land` know it. */
export const transform = transformSplice;

/** Old text no shorter than this may be looked for elsewhere when its splice collides. */
export const SEARCH_MIN = 8;

/** The occurrence of `needle` nearest to `near`, or -1. */
function nearest(text: string, needle: string, near: number): number {
	let best = -1;
	for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
		if (best === -1 || Math.abs(i - near) < Math.abs(best - near)) best = i;
		if (i > near) break;
	}
	return best;
}

export interface Landed {
	text: string;
	/** What was applied, in the server's text, sequential: what other pages are sent. */
	applied: Splice[];
	/** Indexes into the batch of the splices that did not land. */
	refused: number[];
}

/**
 * Land a page's batch, made on a text that has since had `concurrent` applied to it.
 *
 * Each splice is moved past the concurrent ones (`transform`), and the concurrent ones past it,
 * so the next splice of the batch is moved through them in its own text. A splice whose old
 * characters are not where it is moved to — because it collided, or because the history it
 * would need was not kept — is looked for by its old text near where it should be, and refused
 * when that is too short to be sure of or not there. From the first such splice on the map is
 * no longer exact, so the rest of the batch is found the same way.
 */
export function land(text: string, batch: readonly Splice[], concurrent: readonly Splice[] | undefined): Landed {
	let current = text;
	let others: Splice[] | undefined = concurrent ? [...concurrent] : undefined;
	const applied: Splice[] = [];
	const refused: number[] = [];
	batch.forEach((splice, index) => {
		let moved: Splice | undefined = splice;
		let approx = splice.at;
		if (others) {
			const next: Splice[] = [];
			for (const other of others) {
				approx = shiftPoint(approx, other);
				if (!moved) continue;
				const mine = transform(moved, other, true);
				const theirs = transform(other, moved, false);
				if (!mine || !theirs) {
					moved = undefined;
					continue;
				}
				moved = mine;
				next.push(theirs);
			}
			others = moved ? next : undefined;
		} else moved = undefined;
		let at = moved && current.slice(moved.at, moved.at + splice.before.length) === splice.before ? moved.at : -1;
		if (at === -1 && splice.before.length >= SEARCH_MIN) {
			at = nearest(current, splice.before, Math.max(0, Math.min(current.length, approx)));
			// A splice found by search leaves the concurrent list unmapped for the rest of the batch.
			others = undefined;
		}
		if (at === -1 || at > current.length) {
			refused.push(index);
			others = undefined;
			return;
		}
		const landed = { at, before: splice.before, text: splice.text };
		current = applySplice(current, landed);
		applied.push(landed);
	});
	return { text: current, applied, refused };
}

/** A point moved past one splice, staying before an insertion made exactly at it. */
function shiftPoint(point: number, splice: Splice): number {
	if (point <= splice.at) return point;
	if (point >= splice.at + splice.before.length) return point + splice.text.length - splice.before.length;
	return splice.at + splice.text.length;
}

/**
 * The splices that turn `from` into `to`, sequential and in source order.
 *
 * Diffed by word rather than by character or line: a word keeps the diff fast, and a line would
 * make an agent's one-word change claim the whole line, so a person typing elsewhere on it would
 * collide with it. XML tags are words of their own, since a `document.xml` is one long line.
 */
export function spliceDiff(from: string, to: string): Splice[] {
	if (from === to) return [];
	// The common start and end are cut off first, so the diff only ever sees the part that moved.
	let head = 0;
	const max = Math.min(from.length, to.length);
	while (head < max && from.charCodeAt(head) === to.charCodeAt(head)) head++;
	let tail = 0;
	while (tail < max - head && from.charCodeAt(from.length - 1 - tail) === to.charCodeAt(to.length - 1 - tail)) tail++;
	// Back to a word boundary, so a hunk starts and ends on whole words.
	while (head > 0 && !BOUNDARY.test(from[head - 1]!)) head--;
	while (tail > 0 && !BOUNDARY.test(from[from.length - tail]!)) tail--;
	const a = tokens(from.slice(head, from.length - tail));
	const b = tokens(to.slice(head, to.length - tail));
	const out: Splice[] = [];
	let at = head;
	let before = "";
	let text = "";
	const flush = () => {
		if (before || text) out.push({ at, before, text });
		at += text.length;
		before = "";
		text = "";
	};
	for (const part of diffArrays(a, b)) {
		const value = part.value.join("");
		if (part.removed) before += value;
		else if (part.added) text += value;
		else {
			flush();
			at += value.length;
		}
	}
	flush();
	return out;
}

const BOUNDARY = /[\s<>]/;

/** Tags, runs of space, and the words between them. */
function tokens(text: string): string[] {
	return text.match(/<[^>]*>|\s+|[^\s<]+/g) ?? [];
}

/** The splices that undo `splices`: each turned round, last first. */
export function invert(splices: readonly Splice[]): Splice[] {
	return [...splices].reverse().map((splice) => ({ at: splice.at, before: splice.text, text: splice.before }));
}
