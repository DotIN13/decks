import type { PenDocument } from "@decks/pen";
import { Refused } from "../../protocol/index.ts";
import type { Change } from "../kernel/types.ts";

// A drawing's changes, oldest first, and the person's undo and redo.
// An undo or redo applies only while the step it takes back is the latest
// change; anyone else's change since makes it refuse, naming who.

/** How many changes and undo steps a drawing keeps in memory. */
export const KEEP = 500;

type Step = { before: PenDocument; after: PenDocument };

export class Log {
	private changes: Change[] = [];
	private undos: Step[] = [];
	private redos: Step[] = [];
	/** Who changed the drawing after the person's last step, if anyone. */
	private since_: string | undefined;

	add(change: Change, own: boolean): void {
		this.changes.push(change);
		if (this.changes.length > KEEP) this.changes.shift();
		if (own) return;
		this.since_ = change.by;
		this.undos = [];
		this.redos = [];
	}

	since(rev: number): Change[] {
		return this.changes.filter((c) => c.rev > rev);
	}

	/** A person's own edit: undoable, and it ends what could be redone. */
	edited(before: PenDocument, after: PenDocument): void {
		this.undos.push({ before, after });
		if (this.undos.length > KEEP) this.undos.shift();
		this.redos = [];
		this.since_ = undefined;
	}

	can(): { undo: boolean; redo: boolean } {
		return { undo: this.undos.length > 0, redo: this.redos.length > 0 };
	}

	/** The drawing an undo (or redo) goes to; done() moves the step across. */
	take(redo: boolean): { doc: PenDocument; done(): void } {
		const from = redo ? this.redos : this.undos;
		const to = redo ? this.undos : this.redos;
		const last = from[from.length - 1];
		if (!last && this.since_) throw new Refused("conflict", `${this.since_} changed the drawing since your last edit, so it cannot be ${redo ? "redone" : "undone"}.`, "item.batch");
		if (!last) throw new Refused("refused", redo ? "Nothing on this canvas to redo." : "Nothing on this canvas to undo.", "canvas.get");
		return { doc: redo ? last.after : last.before, done: () => { from.pop(); to.push(last); } };
	}
}
