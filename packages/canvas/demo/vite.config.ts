import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

/** The package's demo: `npm run demo --workspace @decks/canvas`, a canvas from a `.pen` file with no Decks server. */
export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	plugins: [solid(), tailwind()],
	// The engine's render worker imports the engine's module (`stage/render.worker.ts`).
	worker: { format: "es" },
	server: {
		host: "127.0.0.1",
		port: Number(process.env.PORT ?? 4790),
		strictPort: true,
		// The package's sources and the engine's wasm are outside the demo folder.
		fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] },
	},
});
