import { PALETTE } from "./clean.ts";

// Where each line on a canvas points, what it selected, and the colour its
// cursor wears: one colour per line, the palette's least worn on that canvas.

export type Said = { pointer?: { x: number; y: number } | null; selection?: string[]; camera?: { x: number; y: number; zoom: number } | null };
type Seen = { canvas: string; color: string };

export class Presence {
	private lines = new Map<string, Seen>();

	/** The colour this line wears on the canvas, given once. */
	colorOf(client: string, canvas: string): string {
		const was = this.lines.get(client);
		if (was?.canvas === canvas) return was.color;
		const worn = [...this.lines.values()].filter((s) => s.canvas === canvas).map((s) => s.color);
		const color = PALETTE.find((c) => !worn.includes(c)) ?? PALETTE[worn.length % PALETTE.length]!;
		this.lines.set(client, { canvas, color });
		return color;
	}

	/** The canvas a line last spoke on, now that it has gone. */
	leave(client: string): string | undefined {
		const was = this.lines.get(client);
		this.lines.delete(client);
		return was?.canvas;
	}
}
