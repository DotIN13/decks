import { createServer } from "node:http";
import { App } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createHttpApp } from "./http.ts";
import { installDir } from "./agents/context.ts";
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
	(message, reply) => app.handle(message, reply),
	(reply) => app.greet(reply),
);
app.attach(hub);

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
