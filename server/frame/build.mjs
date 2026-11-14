#!/usr/bin/env node
// Builds canvas-frame.html alone from harness/page's vite config into server/frame/dist,
// its assets under /frame-assets/. A heavy job: node tools/heavy.mjs --wait -- node server/frame/build.mjs
import { fileURLToPath } from "node:url";
import { build } from "vite";

const page = fileURLToPath(new URL("../../harness/page/", import.meta.url));
await build({
	configFile: `${page}vite.config.ts`,
	root: page,
	base: "/frame-assets/",
	logLevel: "warn",
	build: {
		outDir: fileURLToPath(new URL("./dist/", import.meta.url)),
		emptyOutDir: true,
		rollupOptions: { input: { frame: `${page}canvas-frame.html` } },
	},
});
console.log("built server/frame/dist/canvas-frame.html");
