import { credentialsOf, fromBrowser } from "./share/person-key.ts";
import { extraHosts, hostAllowed } from "./share/hosts.ts";
import { createServer } from "node:http";
import { appUpgrade } from "./apps/route.ts";
import { forwardUpgrade } from "./ports.ts";
import { App } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createHttpApp } from "./http.ts";
import { installDir } from "@decks/runtime";
import { Hub } from "./ws.ts";
import { startStudio } from "./studio/index.ts";

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

// Decks Studio: syncs the deck in the background once this harness has a key (`studio/index.ts`).
// Its app list goes to Studio too, so Studio can list the apps beside the canvases.
const studio = startStudio(app.deck.path, process.env, `http://127.0.0.1:${config.port}`, () => app.apps.list());

/*
 * One upgrade listener, two websockets.
 *
 * `/ws` is the browser; `/api/web/relay` is the Decks extension in the user's own Chrome,
 * dialling in with its pairing code (`browser/bridge.ts`); `/node/…` and `/rnode/…` are a
 * forwarded port's own websockets (`ports.ts`). Anything else is not a websocket this
 * server has, and is dropped rather than left hanging.
 */
const hosts = extraHosts(process.env, config.host);
httpServer.on("upgrade", (request, socket, head) => {
	// A socket addressed to a name that is not this server's is a rebinding page, as for requests (`share/hosts.ts`).
	if (!hostAllowed(request.headers.host, hosts)) {
		socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
		socket.destroy();
		return;
	}
	const path = new URL(request.url ?? "/", "http://decks").pathname;
	if (path === "/ws") {
		/*
		 * The socket runs commands, so a browser gets it only with credentials, from this site as from
		 * any other: the person key the Decks page holds, or a paired token (`share/person-key.ts`).
		 * A program on this machine opens it as before.
		 */
		if (fromBrowser(request.headers) && !credentialsOf(request, app.personKey, app.pairing)) {
			socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}
		hub.handleUpgrade(request, socket, head);
	}
	else if (path === "/api/web/relay") app.web.handleUpgrade(request, socket, head);
	else if (appUpgrade(request, socket, head, app.apps, (token, origin) => app.pairing.verdict(token, origin) === "paired")) return;
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
	void studio.stop();
	app.dispose();
	hub.close();
	httpServer.close(() => process.exit(0));
	// A socket that will not close must not hold the process open forever.
	setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
