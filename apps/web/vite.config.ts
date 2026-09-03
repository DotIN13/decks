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

export default defineConfig({
	plugins: [solid(), tailwind()],
	server: {
		host: "127.0.0.1",
		port: WEB_PORT,
		strictPort: true,
		proxy: {
			"/api": { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
			"/ws": { target: `ws://127.0.0.1:${API_PORT}`, ws: true },
		},
	},
	build: { target: "es2022", sourcemap: true },
});
