// Today's line at /compat/v1/socket, opened only in the page's compat mode
// (the dev server run with DECKS_PAGE_COMPAT=1, for today's browser checks,
// which read the frames the page sends). Goes with compat, after stop 3.

type Answer = { ok: boolean; value?: unknown; error?: string };

/** The old line, while open; not drawn. */
const old = { socket: undefined as WebSocket | undefined, next: 0, waiting: new Map<string, (answer: Answer) => void>(), queue: [] as string[] };

/** Today's line address beside a server address. */
export const oldLineUrl = (url: string): string => `${url.replace(/^http/, "ws")}/compat/v1/socket`;

/** One of today's calls, as today's page sent it: { type: line.call, id, verb, args }. */
export function oldFrame(id: string, verb: string, args: readonly unknown[]): string {
	return JSON.stringify({ type: "line.call", id, verb, args: [...args] });
}

/** Open today's line with the page's token. Calls made before it is up wait for it. */
export function openOldLine(url: string, token: string): void {
	const socket = new WebSocket(oldLineUrl(url));
	old.socket = socket;
	socket.addEventListener("open", () => {
		socket.send(JSON.stringify({ type: "line.hello", token, all: false, greet: false }));
		for (const frame of old.queue.splice(0)) socket.send(frame);
	});
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(String(event.data)) as { type?: string; id?: string } & Answer;
		if (message.type === "call.answered" && message.id) old.waiting.get(message.id)?.(message);
	});
	socket.addEventListener("close", () => {
		if (old.socket === socket) old.socket = undefined;
	});
}

/** Whether today's line was opened (compat mode). */
export const oldLineOpen = (): boolean => old.socket !== undefined;

/** Make one of today's calls on today's line; answers whether it went. */
export function oldCall(verb: string, args: readonly unknown[]): Promise<Answer> {
	const id = `o${(old.next += 1).toString(36)}`;
	const frame = oldFrame(id, verb, args);
	return new Promise((resolve) => {
		old.waiting.set(id, (answer) => (old.waiting.delete(id), resolve(answer)));
		if (old.socket?.readyState === WebSocket.OPEN) old.socket.send(frame);
		else old.queue.push(frame);
	});
}
