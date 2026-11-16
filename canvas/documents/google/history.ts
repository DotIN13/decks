import type { DocsParagraphStyle, DocsRequest, DocsTextStyle } from "./types.ts";
import { isStruct } from "./units.ts";
import { type Step, dedupeBullets } from "./text-units.ts";
import { GoogleView } from "./view.ts";

/** A GoogleView's undo and redo: steps recorded, joined, applied here and inverted, added to its prototype. */

declare module "./view.ts" {
	interface GoogleView {
		transact(work: () => void): void;
		record(step: Step): void;
		join(top: Step, step: Step): boolean;
		undo(): void;
		redo(): void;
		step(from: Step[], to: Step[]): void;
		apply(step: Step): Step | undefined;
		applyLocal(requests: readonly DocsRequest[]): void;
		inverseOf(requests: readonly DocsRequest[]): DocsRequest[];
	}
}

/** Steps made inside `work` become one undo step. */
GoogleView.prototype.transact = function (this: GoogleView, work: () => void): void {
	if (this.batch || this.replaying) return work();
	const batch: Step[] = (this.batch = []);
	try {
		work();
	} finally {
		this.batch = undefined;
	}
	if (batch.length === 1) this.record(batch[0]!);
	else if (batch.length) this.record({ group: batch, ...(batch[0]!.typing === "ins" ? { typing: "ins" as const, time: batch[0]!.time } : {}) });
};

GoogleView.prototype.record = function (this: GoogleView, step: Step): void {
	if (this.replaying) return;
	if (this.batch) return void this.batch.push(step);
	this.redoStack = [];
	const top = this.undoStack[this.undoStack.length - 1];
	if (step.typing && top?.typing === step.typing && (step.time ?? 0) - (top.time ?? 0) < 1500 && this.join(top, step)) return;
	this.undoStack.push(step);
	if (this.undoStack.length > 500) this.undoStack.shift();
};

/** Typing joined to the step before it: Docs undoes a burst of typing, or of deleting, at once. */
GoogleView.prototype.join = function (this: GoogleView, top: Step, step: Step): boolean {
	// Deleting styled text: the deletion and the styles that undo puts back, joined to the deleting before.
	if (top.group?.length === 2 && step.group?.length === 2 && step.typing === "del" && top.group[1]!.splice && step.group[1]!.splice && top.group[0]!.inverse && step.group[0]!.inverse) {
		const a = top.group[1]!.splice;
		const b = step.group[1]!.splice;
		if (a.before || b.before) return false;
		let later = step.group[0]!.inverse;
		if (b.at + b.text.length === a.at) top.group[1]!.splice = { at: b.at, before: "", text: b.text + a.text };
		else if (b.at === a.at) {
			top.group[1]!.splice = { at: a.at, before: "", text: a.text + b.text };
			// Deleted forward: these words sit after the ones already deleted once both are back.
			later = structuredClone(later);
			for (const request of later) {
				const range = (Object.values(request)[0] as { range?: { startIndex: number; endIndex: number } }).range;
				if (range) {
					range.startIndex += a.text.length;
					range.endIndex += a.text.length;
				}
			}
		} else return false;
		// The styles were read with the text in place, so they hold once all of it is back.
		top.group[0]!.inverse = [...top.group[0]!.inverse, ...later];
		top.time = step.time;
		return true;
	}
	// Styled typing: a keystroke and the style sent with it, joined to the run of them before.
	if (top.group && step.group) {
		const [ta, tb] = top.group;
		const [sa, sb] = step.group;
		const tr = tb?.requests?.[0];
		const sr = sb?.requests?.[0];
		if (top.group.length !== 2 || step.group.length !== 2 || !ta?.splice || !sa?.splice || !tr || !sr || !("updateTextStyle" in tr) || !("updateTextStyle" in sr)) return false;
		if (sa.splice.text || ta.splice.at + ta.splice.before.length !== sa.splice.at) return false;
		if (JSON.stringify([tr.updateTextStyle.textStyle, tr.updateTextStyle.fields]) !== JSON.stringify([sr.updateTextStyle.textStyle, sr.updateTextStyle.fields]) || tr.updateTextStyle.range.endIndex !== sr.updateTextStyle.range.startIndex) return false;
		ta.splice = { ...ta.splice, before: ta.splice.before + sa.splice.before };
		tb!.requests = [{ updateTextStyle: { ...tr.updateTextStyle, range: { startIndex: tr.updateTextStyle.range.startIndex, endIndex: sr.updateTextStyle.range.endIndex } } }];
		tb!.inverse = [...(sb!.inverse ?? []), ...(tb!.inverse ?? [])];
		top.time = step.time;
		return true;
	}
	const a = top.splice;
	const b = step.splice;
	if (!a || !b) return false;
	if (step.typing === "ins") {
		if (b.text || a.at + a.before.length !== b.at) return false;
		top.splice = { at: a.at, before: a.before + b.before, text: a.text };
	} else {
		if (a.before || b.before) return false;
		if (b.at + b.text.length === a.at) top.splice = { at: b.at, before: "", text: b.text + a.text };
		else if (b.at === a.at) top.splice = { at: a.at, before: "", text: a.text + b.text };
		else return false;
	}
	top.time = step.time;
	return true;
};

GoogleView.prototype.undo = function (this: GoogleView): void {
	this.step(this.undoStack, this.redoStack);
};

GoogleView.prototype.redo = function (this: GoogleView): void {
	this.step(this.redoStack, this.undoStack);
};

GoogleView.prototype.step = function (this: GoogleView, from: Step[], to: Step[]): void {
	this.pending = undefined;
	for (let step = from.pop(); step; step = from.pop()) {
		const done = this.apply(step);
		// A step whose words someone else has since changed is passed over, as Docs passes it.
		if (!done) continue;
		to.push(done);
		return;
	}
};

/** Do what a step says, and answer the step that takes it back. */
GoogleView.prototype.apply = function (this: GoogleView, step: Step): Step | undefined {
	if (step.group) {
		const done: Step[] = [];
		for (const part of [...step.group].reverse()) {
			const back = this.apply(part);
			if (back) done.push(back);
		}
		return done.length ? { group: done } : undefined;
	}
	if (step.splice) {
		const s = step.splice;
		if (this.sync.text.slice(s.at, s.at + s.before.length) !== s.before) return undefined;
		this.replaying = true;
		try {
			this.pending = undefined;
			const before = this.sync.text.slice(s.at, s.at + s.before.length);
			this.sync.edit({ at: s.at, before, text: s.text });
			this.select(s.at + s.text.length);
		} finally {
			this.replaying = false;
		}
		return { splice: { at: s.at, before: s.text, text: s.before } };
	}
	if (step.table) {
		const done = this.perform(step.table);
		return done ? { table: done } : undefined;
	}
	if (step.pagebreak) {
		const done = this.breakPage(step.pagebreak);
		return done ? { pagebreak: done } : undefined;
	}
	if (step.requests && step.inverse) {
		this.applyLocal(step.inverse);
		this.host.style(structuredClone(step.inverse));
		this.render();
		const range = (Object.values(step.inverse[0] ?? {})[0] as { range?: { startIndex: number; endIndex: number } } | undefined)?.range;
		if (range) this.select(range.startIndex, range.endIndex);
		return { requests: step.inverse, inverse: step.requests };
	}
	return undefined;
};

/** Requests as Docs would apply them, to the units here: the styles a page draws with. */
GoogleView.prototype.applyLocal = function (this: GoogleView, requests: readonly DocsRequest[]): void {
	for (const request of requests) {
		if ("updateTextStyle" in request) {
			const { range, textStyle, fields } = request.updateTextStyle;
			for (let i = range.startIndex; i < Math.min(range.endIndex, this.units.length); i++) {
				const unit = this.units[i]!;
				if (unit.ch === "\n" || isStruct(unit.ch)) continue;
				const next = { ...(unit.ts ?? {}) } as Record<string, unknown>;
				for (const field of fields.split(",")) {
					// A field left out goes back to the paragraph's; false is kept, as Docs keeps it, to undo a heading's bold.
					const value = (textStyle as Record<string, unknown>)[field];
					if (value === undefined) delete next[field];
					else next[field] = value;
				}
				unit.ts = next as DocsTextStyle;
			}
		} else if ("updateParagraphStyle" in request) {
			const { range, paragraphStyle, fields } = request.updateParagraphStyle;
			for (const nl of this.paragraphsIn(range.startIndex, range.endIndex)) {
				const para = (this.units[nl]!.para ??= { ps: {} });
				const next = { ...para.ps } as Record<string, unknown>;
				for (const field of fields.split(",")) {
					const value = (paragraphStyle as Record<string, unknown>)[field];
					if (value === undefined) delete next[field];
					else next[field] = value;
				}
				para.ps = next as DocsParagraphStyle;
			}
		} else if ("createParagraphBullets" in request) {
			const numbered = request.createParagraphBullets.bulletPreset.startsWith("NUMBERED");
			const hint = this.hints.get(request);
			const listId = hint?.listId ?? this.localList(numbered);
			const { startIndex, endIndex } = request.createParagraphBullets.range;
			// Made here with leading tabs for depth: the page has no tabs, so the paragraphs are counted instead of the range.
			const nls = hint ? this.paragraphsFrom(startIndex, hint.levels.length) : this.paragraphsIn(startIndex, endIndex);
			nls.forEach((nl, k) => ((this.units[nl]!.para ??= { ps: {} }).bullet = { listId, nestingLevel: hint?.levels[k] ?? 0 }));
		} else if ("deleteParagraphBullets" in request) {
			// Docs keeps the text where it sat: the list's indent becomes the paragraph's own.
			for (const nl of this.paragraphsIn(request.deleteParagraphBullets.range.startIndex, request.deleteParagraphBullets.range.endIndex)) {
				const para = this.units[nl]!.para;
				const bullet = para?.bullet;
				if (!para || !bullet) continue;
				const level = this.doc?.lists?.[bullet.listId ?? ""]?.listProperties?.nestingLevels?.[bullet.nestingLevel ?? 0];
				delete para.bullet;
				if (level?.indentStart) para.ps = { ...para.ps, indentStart: level.indentStart, indentFirstLine: level.indentStart };
			}
		}
	}
};

/** The requests that put back what `requests` would change, from the units as they are now. */
GoogleView.prototype.inverseOf = function (this: GoogleView, requests: readonly DocsRequest[]): DocsRequest[] {
	const groups: DocsRequest[][] = [];
	for (const request of requests) {
		const out: DocsRequest[] = [];
		groups.push(out);
		if ("updateTextStyle" in request) {
			const { range, fields } = request.updateTextStyle;
			for (const field of fields.split(",")) {
				// Runs of the same old value, each set back to it.
				let start = range.startIndex;
				const value = (i: number) => JSON.stringify((this.units[i]?.ts as Record<string, unknown> | undefined)?.[field] ?? null);
				for (let i = range.startIndex + 1; i <= range.endIndex; i++) {
					if (i < range.endIndex && value(i) === value(start)) continue;
					const old = (this.units[start]?.ts as Record<string, unknown> | undefined)?.[field];
					out.push({ updateTextStyle: { range: { startIndex: start, endIndex: i }, textStyle: (old === undefined ? {} : { [field]: old }) as DocsTextStyle, fields: field } });
					start = i;
				}
			}
		} else if ("updateParagraphStyle" in request) {
			const { range, fields } = request.updateParagraphStyle;
			for (const nl of this.paragraphsIn(range.startIndex, range.endIndex)) {
				const ps = (this.units[nl]!.para?.ps ?? {}) as Record<string, unknown>;
				const old: Record<string, unknown> = {};
				for (const field of fields.split(",")) if (ps[field] !== undefined) old[field] = ps[field];
				const start = this.paragraphStart(nl);
				out.push({ updateParagraphStyle: { range: { startIndex: start, endIndex: Math.max(start + 1, nl) }, paragraphStyle: old as DocsParagraphStyle, fields } });
			}
		} else if ("createParagraphBullets" in request || "deleteParagraphBullets" in request) {
			const range = "createParagraphBullets" in request ? request.createParagraphBullets.range : request.deleteParagraphBullets.range;
			const hint = "createParagraphBullets" in request ? this.hints.get(request) : undefined;
			const nls = hint ? this.paragraphsFrom(range.startIndex, hint.levels.length) : this.paragraphsIn(range.startIndex, range.endIndex);
			if (!nls.length) continue;
			const first = this.paragraphStart(nls[0]!);
			out.push({ deleteParagraphBullets: { range: { startIndex: first, endIndex: Math.max(first + 1, nls[nls.length - 1]!) } } });
			// Each paragraph's own indents as they were, then each run of list items as it was, last first.
			for (const nl of nls) {
				const ps = this.units[nl]!.para?.ps ?? {};
				const start = this.paragraphStart(nl);
				out.push({ updateParagraphStyle: { range: { startIndex: start, endIndex: Math.max(start + 1, nl) }, paragraphStyle: { ...(ps.indentStart ? { indentStart: ps.indentStart } : {}), ...(ps.indentFirstLine ? { indentFirstLine: ps.indentFirstLine } : {}) }, fields: "indentStart,indentFirstLine" } });
			}
			const runs: number[][] = [];
			nls.forEach((nl, k) => {
				const bullet = this.units[nl]!.para?.bullet;
				const prev = k > 0 ? this.units[nls[k - 1]!]!.para?.bullet : undefined;
				if (!bullet) return;
				if (prev && prev.listId === bullet.listId) runs[runs.length - 1]!.push(nl);
				else runs.push([nl]);
			});
			for (const run of runs.reverse()) {
				const bullet = this.units[run[0]!]!.para!.bullet!;
				out.push(...this.bullets(run, run.map((nl) => this.units[nl]!.para?.bullet?.nestingLevel ?? 0), this.isNumbered(bullet), bullet.listId));
			}
		}
	}
	// Undone in the opposite order, so a later request's undo does not fight an earlier one's.
	return dedupeBullets(groups.reverse().flat());
};
