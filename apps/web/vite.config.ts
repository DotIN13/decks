import tailwind from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

/**
 * The dev server proxies to the API rather than talking to it cross-origin.
 *
 * That is not only convenience: boards are served from `/api/board/...` into
 * same-origin frames (DESIGN §4), and "same origin" has to be true of the origin
 * the browser actually loaded, which in development is Vite's.
 */
/*
 * The ports come from the environment, with the defaults they used to be hardcoded as.
 *
 * Because there is more than one deck on this machine. A second copy of the app — a
 * branch under review, the e2e fixture — cannot start while the first one holds 4329,
 * and `strictPort` means it fails rather than quietly moving. `e2e/harness.mjs` already
 * reads `DECKS_E2E_WEB` and `DECKS_E2E_API`; this is the other half of that, so the two
 * halves can finally agree.
 */
const API_PORT = Number(process.env.DECKS_PORT ?? 4329);
const WEB_PORT = Number(process.env.DECKS_WEB_PORT ?? 4328);
/*
 * Loopback unless asked otherwise, which is the right default for a dev server.
 *
 * `DECKS_WEB_HOST=0.0.0.0` makes it reachable from the network — useful for looking at the
 * app on a phone, and worth doing deliberately rather than by default: this server has no
 * authentication, and the deck it is showing is whatever `DECKS_DATA_DIR` points at.
 *
 * Only the web port needs exposing. The API is reached through Vite's proxy, which connects
 * from the server side, so `DECKS_HOST` can stay on loopback and the websocket still works.
 */
const WEB_HOST = process.env.DECKS_WEB_HOST ?? "127.0.0.1";
/*
 * Which `Host` headers this server will answer to, once it is not on loopback.
 *
 * Vite refuses a request whose Host is a name it was not told about — the defence against DNS
 * rebinding, where a page you are looking at resolves a name it controls to 127.0.0.1 and
 * reads a dev server that trusts anything local. An **address** is always allowed, so
 * `http://100.x.y.z:4327` works with nothing set; a **name** is not, which is exactly the
 * case a Tailscale MagicDNS host is: `jules.tail39f75c.ts.net` was answered with "Blocked
 * request" and nothing else — no clue as to why.
 *
 * So `.ts.net` is allowed by default when the server is exposed at all, because every name
 * under it resolves inside somebody's tailnet and reaching this one means already being on
 * *this* tailnet. Anything else is named deliberately, comma-separated:
 *
 *     DECKS_WEB_ALLOWED=deck.example.internal,.lan
 *
 * On loopback nothing is set and nothing changes: `localhost` is allowed on its own.
 */
const named = (process.env.DECKS_WEB_ALLOWED ?? "")
	.split(",")
	.map((host) => host.trim())
	.filter(Boolean);
const LOOPBACK = WEB_HOST === "127.0.0.1" || WEB_HOST === "localhost" || WEB_HOST === "::1";
const ALLOWED_HOSTS = named.length > 0 ? named : LOOPBACK ? undefined : [".ts.net"];

export default defineConfig({
	plugins: [solid(), tailwind()],
	server: {
		host: WEB_HOST,
		port: WEB_PORT,
		strictPort: true,
		...(ALLOWED_HOSTS ? { allowedHosts: ALLOWED_HOSTS } : {}),
		proxy: {
			"/api": { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
			"/ws": { target: `ws://127.0.0.1:${API_PORT}`, ws: true },
		},
	},
	build: { target: "es2022", sourcemap: true },
});
