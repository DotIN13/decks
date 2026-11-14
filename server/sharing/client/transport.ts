// How the client reaches Studio: a fetch for the routes and a live line for
// the socket. Decks-local hands it the network; tests hand it the hub.

export interface LiveLink {
	send(text: string): void;
	close(): void;
	onMessage(hear: (text: string) => void): void;
	onClose(hear: (code: number, reason: string) => void): void;
}

export interface Transport {
	fetch(req: Request): Promise<Response>;
	live?(url: string, key: string): LiveLink;
}

/** Studio said no: its status, its sentence, and how long to wait when it asked for a pause. */
export class StudioError extends Error {
	constructor(readonly status: number, message: string, readonly retryAfter?: number) {
		super(message);
	}
}

/** One call to Studio's /sync/v1 routes, answered as JSON or bytes. */
export class StudioApi {
	constructor(private readonly url: string, private readonly key: string, private readonly transport: Transport) {}

	async call(method: string, path: string, body?: unknown): Promise<any> {
		const res = await this.send(method, path, body === undefined ? undefined : JSON.stringify(body), "application/json");
		return res.json();
	}

	async put(path: string, bytes: Uint8Array): Promise<any> {
		const res = await this.send("PUT", path, bytes, "application/octet-stream");
		return res.json();
	}

	async bytes(path: string): Promise<Uint8Array> {
		const res = await this.send("GET", path);
		return new Uint8Array(await res.arrayBuffer());
	}

	live(): LiveLink | undefined {
		return this.transport.live?.(`${this.url.replace(/^http/, "ws")}/sync/v1/live`, this.key);
	}

	private async send(method: string, path: string, body?: string | Uint8Array, type?: string): Promise<Response> {
		const headers: Record<string, string> = { Authorization: `Bearer ${this.key}` };
		if (type && body !== undefined) headers["Content-Type"] = type;
		const res = await this.transport.fetch(new Request(`${this.url}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) }));
		if (res.ok) return res;
		const said = (await res.json().catch(() => ({}))) as { error?: string };
		const wait = Number(res.headers.get("retry-after"));
		throw new StudioError(res.status, said.error ?? `Studio answered ${res.status}.`, Number.isFinite(wait) && wait > 0 ? wait : undefined);
	}
}
