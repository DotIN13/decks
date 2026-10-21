import { createReadStream, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOUNDS = join(dirname(fileURLToPath(import.meta.url)), "sounds");

/**
 * The canvas's cues at `/sounds/` (`@decks/canvas/alerts`): served from this package while Vite
 * runs, and written into the build. One line in a host's Vite config: `plugins: [decksSounds()]`.
 */
export function decksSounds() {
	return {
		name: "decks-sounds",
		configureServer(server) {
			server.middlewares.use("/sounds", (req, res, next) => {
				const name = decodeURIComponent((req.url ?? "/").split("?")[0].slice(1));
				if (!/^[\w.-]+\.(mp3|txt)$/.test(name) && name !== "LICENSE") return next();
				try {
					if (!readdirSync(SOUNDS).includes(name)) return next();
				} catch {
					return next();
				}
				res.setHeader("Content-Type", name.endsWith(".mp3") ? "audio/mpeg" : "text/plain; charset=utf-8");
				createReadStream(join(SOUNDS, name)).pipe(res);
			});
		},
		generateBundle() {
			for (const name of readdirSync(SOUNDS)) this.emitFile({ type: "asset", fileName: `sounds/${name}`, source: readFileSync(join(SOUNDS, name)) });
		},
	};
}
