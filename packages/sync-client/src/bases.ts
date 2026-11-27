import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse, serialize, type PenDocument } from "@decks/pen";
import { readFileSync, writeFileSync } from "./state.ts";

/**
 * The last agreed drawing of each canvas, by its Studio id: what local edits are worked out against
 * (`diff`) and what Studio's changes are applied to. Kept parsed in memory, and in
 * `.decks/sync/<canvas id>.pen` so a restart does not have to ask Studio for every drawing again.
 */
export class Bases {
	private readonly kept = new Map<string, { doc: PenDocument; text: string }>();

	constructor(private readonly dir: string) {}

	private path(id: string): string {
		return join(this.dir, `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.pen`);
	}

	/** Keep a canvas's last agreed drawing, in memory and in `.decks/sync/<id>.pen`, when it changed. */
	keep(id: string, doc: PenDocument, text = serialize(doc)) {
		if (this.kept.get(id)?.text === text) return;
		mkdirSync(this.dir, { recursive: true, mode: 0o700 });
		writeFileSync(this.path(id), text, { mode: 0o600 });
		this.kept.set(id, { doc, text });
	}

	/** A canvas's last agreed drawing, from memory or its file; undefined when there is none. */
	of(id: string): { doc: PenDocument; text: string } | undefined {
		const kept = this.kept.get(id);
		if (kept) return kept;
		try {
			const text = readFileSync(this.path(id), "utf8");
			const one = { doc: parse(text), text };
			this.kept.set(id, one);
			return one;
		} catch {
			return undefined;
		}
	}

	/** A canvas no longer synced: its drawing goes from memory and from disk. */
	forget(id: string) {
		this.kept.delete(id);
		rmSync(this.path(id), { force: true });
	}

	/** Another account's key: nothing kept in memory is theirs. The files stay, named by canvas ids this account never sees. */
	clear() {
		this.kept.clear();
	}
}
