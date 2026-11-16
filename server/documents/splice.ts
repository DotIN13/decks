// Splices: { at, before, text }, at in UTF-16 units, sequential within a batch.
// Two writers' splices made on one text are moved past each other so both
// ends agree to the letter; overlaps merge, and neither loses its new words.

export type Splice = { at: number; before: string; text: string };

export const applySplice = (text: string, s: Splice): string => text.slice(0, s.at) + s.text + text.slice(s.at + s.before.length);

export const fits = (text: string, s: Splice): boolean => s.at >= 0 && s.at <= text.length && text.slice(s.at, s.at + s.before.length) === s.before;

/** Sequential splices applied, or undefined when one does not find its old words. */
export function applyAll(text: string, splices: readonly Splice[]): string | undefined {
	let out = text;
	for (const s of splices) {
		if (!fits(out, s)) return undefined;
		out = applySplice(out, s);
	}
	return out;
}

/** a as it reads after b, both made on the same text: zero, one or two splices. */
export function transform(a: Splice, b: Splice, aFirst: boolean): Splice[] {
	const aEnd = a.at + a.before.length;
	const bEnd = b.at + b.before.length;
	const past = (at: number) => b.at + b.text.length + (at - bEnd);
	const out: Splice[] = [];
	if (a.at < b.at || (a.at === b.at && aFirst)) {
		const leftEnd = Math.min(aEnd, b.at);
		const left = { at: a.at, before: a.before.slice(0, leftEnd - a.at), text: a.text };
		out.push(left);
		const rightStart = Math.max(a.at, bEnd);
		if (aEnd > rightStart) out.push({ at: past(rightStart) + left.text.length - left.before.length, before: a.before.slice(rightStart - a.at), text: "" });
	} else {
		const start = Math.max(a.at, bEnd);
		out.push({ at: past(start), before: aEnd > start ? a.before.slice(start - a.at) : "", text: a.text });
	}
	return out.filter((s) => s.before.length > 0 || s.text.length > 0);
}

/** Two sequences made on one text, each moved past the other. */
export function transformAll(a: readonly Splice[], b: readonly Splice[], aFirst: boolean): { a: Splice[]; b: Splice[] } {
	if (a.length === 0 || b.length === 0) return { a: [...a], b: [...b] };
	if (a.length === 1 && b.length === 1) return { a: transform(a[0]!, b[0]!, aFirst), b: transform(b[0]!, a[0]!, !aFirst) };
	if (a.length > 1) {
		const head = transformAll(a.slice(0, 1), b, aFirst);
		const rest = transformAll(a.slice(1), head.b, aFirst);
		return { a: [...head.a, ...rest.a], b: rest.b };
	}
	const head = transformAll(a, b.slice(0, 1), aFirst);
	const rest = transformAll(head.a, b.slice(1), aFirst);
	return { a: rest.a, b: [...head.b, ...rest.b] };
}

export type Landed = { text: string; applied: Splice[]; refused: number[] };

/**
 * A batch made on an older text, landed on text: each splice is moved past
 * since (what landed after its revision). One that no longer fits is refused
 * by index; without since, only splices that still fit where they say land.
 */
export function land(text: string, batch: readonly Splice[], since: readonly Splice[] | undefined): Landed {
	let current = text;
	let others: Splice[] | undefined = since ? [...since] : undefined;
	const applied: Splice[] = [];
	const refused: number[] = [];
	batch.forEach((splice, index) => {
		let pieces: Splice[] = [splice];
		if (others) {
			const moved = transformAll([splice], others, true);
			pieces = moved.a;
			others = moved.b;
		}
		const after = applyAll(current, pieces);
		if (after === undefined) {
			refused.push(index);
			others = undefined;
			return;
		}
		current = after;
		applied.push(...pieces);
	});
	return { text: current, applied, refused };
}

/** The reverse of sequential splices: applied after them, they give the first text back. */
export const invert = (splices: readonly Splice[]): Splice[] => [...splices].reverse().map((s) => ({ at: s.at, before: s.text, text: s.before }));

const MAX_CELLS = 4_000_000;

/** Splices that turn from into to: one per changed run of lines, each trimmed to what changed. */
export function diff(from: string, to: string): Splice[] {
	return diffBy(from, to, lines, (c) => c === "\n");
}

/** The same, by words: a changed word keeps the styles of the words around it (a Google Doc's runs). */
export function wordDiff(from: string, to: string): Splice[] {
	return diffBy(from, to, words, (c) => /[\s<>]/.test(c));
}

function diffBy(from: string, to: string, split: (text: string) => string[], boundary: (c: string) => boolean): Splice[] {
	if (from === to) return [];
	let head = 0;
	const max = Math.min(from.length, to.length);
	while (head < max && from.charCodeAt(head) === to.charCodeAt(head)) head++;
	while (head > 0 && !boundary(from[head - 1]!)) head--;
	let tail = 0;
	while (tail < max - head && from.charCodeAt(from.length - 1 - tail) === to.charCodeAt(to.length - 1 - tail)) tail++;
	while (tail > 0 && !boundary(from[from.length - tail]!)) tail--;
	const a = split(from.slice(head, from.length - tail));
	const b = split(to.slice(head, to.length - tail));
	const hunks = a.length * b.length > MAX_CELLS ? [{ before: a.join(""), text: b.join(""), skip: 0 }] : hunksOf(a, b);
	const out: Splice[] = [];
	let at = head;
	for (const h of hunks) {
		at += h.skip;
		let lead = 0;
		while (lead < h.before.length && lead < h.text.length && h.before[lead] === h.text[lead]) lead++;
		let end = 0;
		while (end < h.before.length - lead && end < h.text.length - lead && h.before[h.before.length - 1 - end] === h.text[h.text.length - 1 - end]) end++;
		const s = { at: at + lead, before: h.before.slice(lead, h.before.length - end), text: h.text.slice(lead, h.text.length - end) };
		if (s.before || s.text) out.push(s);
		at += h.text.length;
	}
	return out;
}

const lines = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const words = (text: string): string[] => text.match(/<[^>]*>|\s+|[^\s<]+/g) ?? [];

/** Changed runs from a longest common sequence of lines; skip is the unchanged length before each run. */
function hunksOf(a: string[], b: string[]): { before: string; text: string; skip: number }[] {
	const n = a.length;
	const m = b.length;
	const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
	const out: { before: string; text: string; skip: number }[] = [];
	let hunk = { before: "", text: "", skip: 0 };
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && a[i] === b[j]) {
			if (hunk.before || hunk.text) out.push(hunk), (hunk = { before: "", text: "", skip: 0 });
			hunk.skip += a[i]!.length;
			i++, j++;
		} else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) hunk.text += b[j++]!;
		else hunk.before += a[i++]!;
	}
	if (hunk.before || hunk.text) out.push(hunk);
	return out;
}
