import tailwind from "@tailwindcss/vite";
import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

// The page's build and dev server. The dev server proxies the server's door,
// so the page calls from its own origin (the server answers no CORS), and it
// serves /page.json: the token the page calls with, read from the deck's lock file.

const PORT = Number(process.env.DECKS_PAGE_PORT ?? 4680);
const HOST = process.env.DECKS_PAGE_HOST ?? "127.0.0.1";
const LOOPBACK = ["127.0.0.1", "localhost", "::1"].includes(HOST);

type Lock = { url: string; token: string };

/** The server to proxy and its person token: the lock file of DECKS_DECK, else DECKS_URL and DECKS_TOKEN. */
function server(): Lock {
	const deck = process.env.DECKS_DECK;
	if (deck) {
		try {
			return JSON.parse(readFileSync(join(deck, ".decks/server.json"), "utf8")) as Lock;
		} catch {
			return { url: "http://127.0.0.1:4620", token: "" };
		}
	}
	return { url: process.env.DECKS_URL ?? "http://127.0.0.1:4620", token: process.env.DECKS_TOKEN ?? "" };
}

/** GET /page.json: where the page's calls go (its own origin) and the token they carry. Loopback only. */
function pageJson(): Plugin {
	return {
		name: "decks-page-json",
		configureServer(dev) {
			dev.middlewares.use((req, res, next) => {
				if ((req.url ?? "").split("?")[0] !== "/page.json") return next();
				res.setHeader("Content-Type", "application/json");
				res.setHeader("Cache-Control", "no-store");
				res.end(JSON.stringify({ url: "", token: server().token, ...(process.env.DECKS_PAGE_COMPAT === "1" ? { compat: true } : {}) }));
			});
		},
	};
}

/** Today's browser checks read the person's token from the page's HTML, as a meta tag: given on loopback only. */
function sessionMeta(): Plugin {
	return {
		name: "decks-session-meta",
		transformIndexHtml: (html) => (LOOPBACK ? html.replace(/<head([^>]*)>/i, `<head$1><meta name="decks-session" content="${server().token}">`) : html),
	};
}

const ROOT = fileURLToPath(new URL(".", import.meta.url));
/** The alerts' cues at /sounds/, from alerts/sounds: served while Vite runs, and written into the build. */
function sounds(): Plugin {
	const folder = fileURLToPath(new URL("./alerts/sounds/", import.meta.url));
	return {
		name: "decks-page-sounds",
		configureServer(dev) {
			dev.middlewares.use("/sounds", (req, res, next) => {
				const name = decodeURIComponent((req.url ?? "/").split("?")[0]?.slice(1) ?? "");
				if (!readdirSync(folder).includes(name)) return next();
				res.setHeader("Content-Type", name.endsWith(".mp3") ? "audio/mpeg" : "text/plain; charset=utf-8");
				createReadStream(join(folder, name)).pipe(res);
			});
		},
		generateBundle() {
			for (const name of readdirSync(folder)) this.emitFile({ type: "asset", fileName: `sounds/${name}`, source: readFileSync(join(folder, name)) });
		},
	};
}

const target = () => server().url;
/** A path that is a file of the page's own (app/, files/) is served here, not passed on. */
const own = (url = "") => (existsSync(join(ROOT, decodeURIComponent(url.split("?")[0] ?? ""))) ? url : undefined);
const pass = (ws = false) => ({ target: target(), changeOrigin: false, ws, xfwd: true, bypass: (req: { url?: string }) => own(req.url) });

export default defineConfig({
	plugins: [solid(), tailwind(), pageJson(), sessionMeta(), sounds()],
	server: {
		host: HOST,
		// The canvas frame is sandboxed, so its origin is "null"; its modules are fetched cross-origin.
		cors: { origin: [/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, "null"] },
		port: PORT,
		strictPort: true,
		proxy: {
			"/api": pass(true),
			"/files/": pass(),
			"/mcp": pass(),
			"/compat/": pass(true),
			// Today's tab socket, which today's browser checks still open; compat answers it.
			"/ws": pass(true),
			"/frame-assets/": pass(),
			"/frame/": pass(true),
			"/app/": pass(true),
			"/node/": pass(true),
			"/rnode/": pass(true),
		},
	},
	preview: { host: HOST, port: PORT + 1, strictPort: true },
	worker: { format: "es" },
	build: {
		target: "es2022",
		sourcemap: true,
		outDir: "dist",
		rollupOptions: { input: { index: fileURLToPath(new URL("./index.html", import.meta.url)), frame: fileURLToPath(new URL("./canvas-frame.html", import.meta.url)) } },
	},
});
