import { fromAnotherSite, tokenOf } from "./share/pairing.ts";
import { createServer } from "node:http";
import { forwardUpgrade } from "./ports.ts";
import { App } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createHttpApp } from "./http.ts";
import { installDir } from "@decks/runtime";
import { Hub } from "./ws.ts";

const config = loadConfig();

// The agent's tools inherit this process's environment, and a script the agent
// writes runs with the deck as its cwd — from where Decks' own `node_modules` is
// not reachable. `??=` so an explicit value still wins.
process.env.DECKS_APP_DIR ??= installDir();

let app: App;
try {
	app = App.open(config);
} catch (error) {
	console.error(`[decks] cannot open ${config.dataDir}: ${(error as Error).message}`);
	process.exit(1);
}

const httpServer = createServer(createHttpApp(app));
const hub = new Hub(
	httpServer,
	(message, reply, view) => app.handle(message, reply, view),
	(reply, view) => app.greet(reply, view),
);
app.attach(hub);

/*
 * One upgrade listener, two websockets.
 *
 * `/ws` is the browser; `/api/web/relay` is the Decks extension in the user's own Chrome,
 * dialling in with its pairing code (`browser/bridge.ts`); `/node/…` and `/rnode/…` are a
 * forwarded port's own websockets (`ports.ts`). Anything else is not a websocket this
 * server has, and is dropped rather than left hanging.
 */
httpServer.on("upgrade", (request, socket, head) => {
	const path = new URL(request.url ?? "/", "http://decks").pathname;
	if (path === "/ws") {
		// A page on another site gets a socket only with a paired token (`share/pairing.ts`).
		if (fromAnotherSite(request.headers) && !app.pairing.check(tokenOf(request.headers, request.url))) {
			socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}
		hub.handleUpgrade(request, socket, head);
	}
	else if (path === "/api/web/relay") app.web.handleUpgrade(request, socket, head);
	else if (!forwardUpgrade(request, socket, head, app.forwards)) socket.destroy();
});

httpServer.on("error", (error) => {
	console.error(`[decks] cannot listen on ${config.host}:${config.port}: ${(error as Error).message}`);
	process.exit(1);
});

httpServer.listen(config.port, config.host, () => {
	console.log(`[decks] ${app.deck.name} — http://${config.host}:${config.port}`);
	console.log(`[decks] data: ${config.dataDir}`);
});

const shutdown = () => {
	app.dispose();
	hub.close();
	httpServer.close(() => process.exit(0));
	// A socket that will not close must not hold the process open forever.
	setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
