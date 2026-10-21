import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

/**
 * A fetch handler on node:http: `(req, res) => Promise<boolean>`, true when it answered. Try it
 * before a server's own routes; false means the path is not the handler's and nothing was sent.
 */
export function nodeHandler(handle: (req: Request) => Promise<Response | undefined>): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
	return async (req, res) => {
		const request = toRequest(req);
		const response = await handle(request);
		if (!response) return false;
		await send(res, response);
		return true;
	};
}

/** node:http's request as a fetch `Request`; its body is read only when the handler reads it. */
export function toRequest(req: IncomingMessage, origin = "http://localhost"): Request {
	const headers = new Headers();
	for (const [k, v] of Object.entries(req.headers)) {
		if (Array.isArray(v)) for (const one of v) headers.append(k, one);
		else if (v !== undefined) headers.set(k, v);
	}
	const method = req.method ?? "GET";
	const body = method === "GET" || method === "HEAD" ? undefined : (Readable.toWeb(req) as unknown as ReadableStream);
	return new Request(new URL(req.url ?? "/", origin), { method, headers, body, duplex: "half" } as RequestInit);
}

/** A fetch `Response` onto node:http's. */
export async function send(res: ServerResponse, response: Response): Promise<void> {
	const headers: Record<string, string> = {};
	response.headers.forEach((v, k) => (headers[k] = v));
	res.writeHead(response.status, headers);
	res.end(Buffer.from(await response.arrayBuffer()));
}
