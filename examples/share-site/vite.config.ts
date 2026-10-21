import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

/** The page, with the server behind it: `npm run start` first. In this repository the canvas comes from its sources, so Solid's plugin compiles them; from npm it comes compiled. */
const site = process.env.SITE ?? "http://127.0.0.1:4900";
export default defineConfig({
	plugins: [solid()],
	worker: { format: "es" },
	optimizeDeps: { exclude: ["@decks/stage", "@decks/canvas"] },
	server: {
		host: "127.0.0.1",
		port: Number(process.env.PAGE_PORT ?? 4901),
		strictPort: true,
		fs: { allow: ["../.."] },
		proxy: { "/sync/v1": { target: site, ws: true }, "/lib": site },
	},
});
