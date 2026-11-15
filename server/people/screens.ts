import type { Infer, shapes } from "../../protocol/index.ts";

// The screens showing canvases: which person's they are, which agent each
// follows, what canvas it shows, and the cameras they report.

export type Camera = Infer<typeof shapes.Camera>;
export type Size = Infer<typeof shapes.Size>;

export interface Screen {
	client: string;
	/** When it last reported, for the newest of a person's screens. */
	at: number;
	person: string;
	/** A canvas frame's own line: it can draw a card, and is no screen to move or count. */
	frame?: boolean;
	follows?: string;
	canvas?: string;
	screen?: Size;
}

type Reading = { camera: Camera; when: number };

export class Screens {
	private all = new Map<string, Screen>();
	private readings = new Map<string, Reading>();
	private tick = 0;

	/** A screen says what it shows; what it leaves out it keeps. */
	report(client: string, person: string, said: { follows?: string; canvas?: string; screen?: Size; frame?: boolean }): Screen {
		const was = this.all.get(client);
		const next: Screen = { ...was, client, person, at: ++this.tick, ...(said.frame ? { frame: true } : {}) };
		if (said.follows !== undefined) next.follows = said.follows;
		if (said.canvas !== undefined) next.canvas = said.canvas;
		if (said.screen !== undefined) next.screen = said.screen;
		this.all.set(client, next);
		return next;
	}

	/** The screens a person looks at: every reporter but the canvas frames' own lines. */
	private screens(): Screen[] {
		return [...this.all.values()].filter((s) => !s.frame);
	}

	/** Every line that can draw a card of the canvas: its frames, then its screens. */
	drawing(canvas: string): Screen[] {
		return [...this.all.values()].filter((s) => s.canvas === canvas).sort((a, b) => Number(!!b.frame) - Number(!!a.frame) || b.at - a.at);
	}

	drop(client: string): void {
		this.all.delete(client);
	}

	has(client: string): boolean {
		return this.all.has(client);
	}

	/** The screens following an agent. */
	following(agent: string): Screen[] {
		return this.screens().filter((s) => s.follows === agent);
	}

	/** One person's own screens. */
	ofPerson(person: string): Screen[] {
		return this.screens().filter((s) => s.person === person);
	}

	/** The person's screen that reported last: the one they are looking at. */
	newestOf(person: string): Screen | undefined {
		return this.ofPerson(person).sort((a, b) => b.at - a.at)[0];
	}

	/** Every screen showing a canvas. */
	showing(canvas: string): Screen[] {
		return this.screens().filter((s) => s.canvas === canvas);
	}

	/** A camera reading, kept per person or agent, canvas and device. */
	record(who: string, canvas: string, device: string | undefined, camera: Camera): void {
		this.readings.set(`${who}\u0000${canvas}\u0000${(device ?? "").slice(0, 64)}`, { camera, when: ++this.tick });
	}

	/** The newest reading of the canvas for that person or agent, from any device. */
	camera(who: string, canvas: string): Camera | undefined {
		let best: Reading | undefined;
		const prefix = `${who}\u0000${canvas}\u0000`;
		for (const [key, reading] of this.readings) if (key.startsWith(prefix) && (!best || reading.when > best.when)) best = reading;
		return best?.camera;
	}

	/** The size the last screen on a canvas said it had. */
	sizeOn(canvas: string, clients: readonly Screen[]): Size | undefined {
		return clients.find((s) => s.screen && s.canvas === canvas)?.screen ?? this.screens().find((s) => s.screen)?.screen;
	}
}
