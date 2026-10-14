import { createServer, get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { appRequest } from "./route.ts";
import type { Apps } from "./service.ts";

function listen(server: Server): Promise<number> {
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

test("a request the browser drops closes the app's side too", async () => {
	// The app streams far more than a socket buffers, as a video does, and says when its socket closes.
	let appClosed!: () => void;
	const closed = new Promise<void>((resolve) => (appClosed = resolve));
	const app = createServer((_req, res) => {
		res.socket?.on("close", appClosed);
		res.writeHead(200, { "content-type": "video/mp4" });
		const chunk = Buffer.alloc(1 << 20);
		const write = (): void => {
			while (res.write(chunk));
			res.once("drain", write);
		};
		write();
	});
	const appPort = await listen(app);
	const apps = {
		exists: () => true,
		manifest: () => ({ kind: "server" }),
		seen: () => {},
		portFor: async () => appPort,
	} as unknown as Apps;
	const decks = createServer((req, res) => void appRequest(req, res as Parameters<typeof appRequest>[1], apps));
	const decksPort = await listen(decks);

	await new Promise<void>((resolve) => {
		const req = get({ host: "127.0.0.1", port: decksPort, path: "/app/review/draft.mp4" }, (res) => {
			res.once("data", () => {
				req.destroy();
				resolve();
			});
		});
	});
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("the app's socket stayed open")), 3000)));
	try {
		await Promise.race([closed, timeout]);
	} finally {
		clearTimeout(timer);
		decks.closeAllConnections();
		decks.close();
		app.closeAllConnections();
		app.close();
	}
});
