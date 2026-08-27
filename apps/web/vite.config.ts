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
export default defineConfig({
	plugins: [solid(), tailwind()],
	server: {
		host: "127.0.0.1",
		port: 4328,
		strictPort: true,
		proxy: {
			"/api": { target: "http://127.0.0.1:4329", changeOrigin: false },
			"/ws": { target: "ws://127.0.0.1:4329", ws: true },
		},
	},
	build: { target: "es2022", sourcemap: true },
});
