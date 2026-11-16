// Canvas passes (README rule 2): a kernel token for the asker on one canvas, an hour long,
// kept in memory; revoked when it runs out. Its id is <asker id>~frame-<n>, so a guard reads who.
// A renewal keeps its pass's id, so the frame's socket takes the new token as the same caller.
import type { Caller } from "../../protocol/index.ts";
import type { Tokens } from "../kernel/index.ts";

export const PASS_MS = 3_600_000;

/** Whether a caller id is a canvas pass's: <asker id>~frame-<n>. */
export const isPass = (id: string): boolean => /(^|~)frame-/.test(id);
type Held = { canvas: string; id: string; expires: number };

/** What a pass needs of the kernel's tokens: issue one, and revoke that one token alone (a renewal shares its id). */
export type PassTokens = Pick<Tokens, "issue"> & { forget(token: string): void };

export class Passes {
	private readonly held = new Map<string, Held>();
	private count = 0;

	constructor(private readonly tokens: PassTokens, private readonly clock: () => number = Date.now, private readonly life: number = PASS_MS) {}

	/**
	 * A pass for the asker on one canvas. `renewing`, a pass still held for the same asker and canvas,
	 * lends its caller id; any other (unknown, run out, someone else's, another canvas's) is ignored.
	 */
	issue(canvas: string, asker: Caller, renewing?: string): { pass: string; expires: number } {
		const id = this.renewedId(canvas, asker, renewing) ?? this.freshId(asker);
		const pass = this.tokens.issue({ kind: asker.kind, id, name: asker.name, canvas }, `canvas pass for ${canvas}`);
		const expires = this.clock() + this.life;
		this.held.set(pass, { canvas, id, expires });
		setTimeout(() => this.end(pass), this.life).unref?.();
		return { pass, expires };
	}

	private freshId(asker: Caller): string {
		this.count += 1;
		return `${asker.id}~frame-${this.count}-${Math.random().toString(36).slice(2, 8)}`;
	}

	private renewedId(canvas: string, asker: Caller, renewing: string | undefined): string | undefined {
		const old = renewing === undefined ? undefined : this.held.get(renewing);
		if (!old || old.expires <= this.clock() || old.canvas !== canvas || !old.id.startsWith(`${asker.id}~frame-`)) return undefined;
		return old.id;
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
		this.tokens.forget(pass);
	}
}
