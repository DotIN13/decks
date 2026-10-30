/**
 * Whether the stage starts its engines again after an error, or stops and says so.
 *
 * An error out of the engine (a Rust panic, or the bindings refusing a call after one) leaves that
 * engine unusable: every later frame fails, and the canvas looks frozen. Starting both engines
 * again, as a lost GPU does (`engine.ts`, `restart`), draws again from the drawing held here. A
 * fault that comes straight back would loop, so after `limit` restarts within `windowMs` the stage
 * stops and asks for a reload instead.
 */
export class Recovery {
	private times: number[] = [];

	constructor(
		private readonly limit = 3,
		private readonly windowMs = 60_000,
		private readonly now: () => number = Date.now,
	) {}

	/** One error: `"restart"` while there have been fewer than `limit` in the window, else `"stop"`. */
	note(): "restart" | "stop" {
		const at = this.now();
		this.times = this.times.filter((one) => at - one < this.windowMs);
		if (this.times.length >= this.limit) return "stop";
		this.times.push(at);
		return "restart";
	}
}
