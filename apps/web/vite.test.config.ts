import { defineConfig } from "vite";
import base from "./vite.config.ts";

// Test harness: web on 4327 proxying to the scratch API on 4339, so the live app on
// 4328/4329 is never disturbed. Delete when the polish work is done.
export default defineConfig({
	...base,
	server: {
		...base.server,
		port: 4327,
		strictPort: true,
		proxy: {
			"/api": { target: "http://127.0.0.1:4339", changeOrigin: false },
			"/ws": { target: "ws://127.0.0.1:4339", ws: true },
		},
	},
});