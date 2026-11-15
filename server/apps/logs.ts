import type { Store } from "../kernel/index.ts";

// Each app's last 600 lines of output, kept in the feature's store. Rule 7.

export const LOG_LINES = 600;
const ERRORS = /\berr(or)?\b|ERR!|failed|exception|cannot|not found|traceback/i;

export class Logs {
	private lines = new Map<string, string[]>();
	private dirty = new Set<string>();

	constructor(private store: Store) {}

	private async load(name: string): Promise<string[]> {
		const had = this.lines.get(name);
		if (had) return had;
		const bytes = await this.store.get(`log/${name}`);
		const lines = bytes ? new TextDecoder().decode(bytes).split("\n").filter(Boolean) : [];
		if (!this.lines.has(name)) this.lines.set(name, lines);
		return this.lines.get(name)!;
	}

	/** Add output, split into lines, each cut at 2000 characters. */
	write(name: string, text: string): void {
		const lines = this.lines.get(name) ?? [];
		this.lines.set(name, lines);
		for (const line of text.replace(/\r/g, "").split("\n")) if (line.length) lines.push(line.slice(0, 2000));
		if (lines.length > LOG_LINES) lines.splice(0, lines.length - LOG_LINES);
		this.dirty.add(name);
	}

	async tail(name: string, count = 200): Promise<string[]> {
		const lines = await this.load(name);
		return lines.slice(-Math.max(1, Math.min(count, LOG_LINES)));
	}

	/** The lines that look like errors, the last twenty. */
	async errors(name: string): Promise<string[]> {
		return (await this.tail(name, 400)).filter((line) => ERRORS.test(line)).slice(-20);
	}

	async save(): Promise<void> {
		for (const name of [...this.dirty]) {
			this.dirty.delete(name);
			await this.store.put(`log/${name}`, new TextEncoder().encode(`${(this.lines.get(name) ?? []).join("\n")}\n`));
		}
	}

	forget(name: string): Promise<void> {
		this.lines.delete(name);
		this.dirty.delete(name);
		return this.store.delete(`log/${name}`);
	}
}
