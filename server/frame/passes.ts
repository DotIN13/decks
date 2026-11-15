// Canvas passes (README rule 2): a kernel token for the asker on one canvas, an hour long,
// kept in memory; revoked when it runs out. Its id is <asker id>~frame-<n>, so a guard reads who.
import type { Caller } from "../../protocol/index.ts";
import type { Tokens } from "../kernel/index.ts";

export const PASS_MS = 3_600_000;

/** Whether a caller id is a canvas pass's: <asker id>~frame-<n>. */
export const isPass = (id: string): boolean => /(^|~)frame-/.test(id);
type Held = { canvas: string; id: string; expires: number };

export class Passes {
	private readonly held = new Map<string, Held>();
	private count = 0;

	constructor(private readonly tokens: Tokens, private readonly clock: () => number = Date.now) {}

	issue(canvas: string, asker: Caller): { pass: string; expires: number } {
		this.count += 1;
		const id = `${asker.id}~frame-${this.count}-${Math.random().toString(36).slice(2, 8)}`;
		const pass = this.tokens.issue({ kind: asker.kind, id, name: asker.name, canvas }, `canvas pass for ${canvas}`);
		const expires = this.clock() + PASS_MS;
		this.held.set(pass, { canvas, id, expires });
		setTimeout(() => this.end(pass), PASS_MS).unref?.();
		return { pass, expires };
	}

	/** The canvas a pass opens now, or undefined when it is unknown or ran out. */
	canvasOf(pass: string): string | undefined {
		const held = this.held.get(pass);
		if (!held) return undefined;
		if (held.expires <= this.clock()) return void this.end(pass);
		return held.canvas;
	}

	end(pass: string): void {
		const held = this.held.get(pass);
		if (!held) return;
		this.held.delete(pass);
		this.tokens.revoke(held.id);
	}
}
