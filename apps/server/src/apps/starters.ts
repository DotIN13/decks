import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppKind } from "./service.ts";

/**
 * What a new app starts from (`decks.apps.create`): the fewest files that run, on the rung the
 * starter is for. Each is small on purpose — the agent writes the app; this only saves it the
 * part every app of that kind has, and gets the two things right that are easy to get wrong
 * here: addresses relative to the app's own (it is served under `/app/<name>/`), and a server
 * that listens on the `PORT` it is given.
 */

export const STARTERS = ["static", "node", "solid", "react", "next"] as const;
export type Starter = (typeof STARTERS)[number];

export const STARTER_KIND: Record<Starter, AppKind> = { static: "static", node: "server", solid: "build", react: "build", next: "server" };

const page = (title: string, body: string, head = "") => `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${escape(title)}</title>
${head}</head>
<body>
${body}
</body>
</html>
`;

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Fits a phone and a desktop tab: a fluid column, type and padding that shrink with the tab, controls a finger can press.
const STYLE = `:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0 auto; max-width: 960px; padding: clamp(16px, 4vw, 32px); line-height: 1.5; }
h1 { font-size: clamp(22px, 5vw, 28px); margin: 0 0 12px; }
img, video, canvas, svg { max-width: 100%; height: auto; }
button, input, select, textarea { font: inherit; min-height: 44px; }
button { padding: 0 16px; }
@media (max-width: 600px) { form { display: flex; flex-direction: column; gap: 8px; } button, input, select { width: 100%; } }
`;

function files(starter: Starter, title: string): Record<string, string> {
	switch (starter) {
		case "static":
			return {
				"app.json": json({ title, kind: "static" }),
				"index.html": page(title, `	<h1>${escape(title)}</h1>\n	<p id="count">Pressed 0 times.</p>\n	<button id="press">Press</button>\n	<script src="app.js"></script>`, `	<link rel="stylesheet" href="style.css" />\n`),
				"style.css": STYLE,
				"app.js": `// Served as it is: no build. Addresses are relative ("style.css", not "/style.css"), since the app lives under /app/<name>/.
let count = Number(localStorage.getItem("count") ?? 0);
const show = () => (document.getElementById("count").textContent = \`Pressed \${count} times.\`);
document.getElementById("press").onclick = () => {
	count += 1;
	localStorage.setItem("count", String(count));
	show();
};
show();
`,
			};
		case "node":
			return {
				"app.json": json({ title, kind: "server", start: "node server.js" }),
				"server.js": `// A server with no packages to install: Node's own http module, a folder of pages, and a JSON file.
// Decks gives it PORT and sends it the requests for /app/<name>/ with that prefix taken off.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
const DATA = new URL("./data.json", import.meta.url);
const PUBLIC = new URL("./public/", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

const load = async () => JSON.parse(await readFile(DATA, "utf8").catch(() => "[]"));

createServer(async (req, res) => {
	const url = new URL(req.url, "http://app");
	if (url.pathname === "/api/items" && req.method === "GET") {
		res.writeHead(200, { "content-type": "application/json" });
		return res.end(JSON.stringify(await load()));
	}
	if (url.pathname === "/api/items" && req.method === "POST") {
		let body = "";
		for await (const chunk of req) body += chunk;
		const items = await load();
		items.push({ text: String(JSON.parse(body || "{}").text ?? "").slice(0, 200), at: Date.now() });
		await writeFile(DATA, JSON.stringify(items, null, "\\t"));
		res.writeHead(201, { "content-type": "application/json" });
		return res.end(JSON.stringify(items));
	}
	const path = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
	try {
		const bytes = await readFile(join(PUBLIC, path));
		res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
		res.end(bytes);
	} catch {
		res.writeHead(404).end("Not found");
	}
}).listen(PORT, "127.0.0.1", () => console.log(\`listening on \${PORT}\`));
`,
				"package.json": json({ name: "app", private: true, type: "module", scripts: { start: "node server.js" } }),
				"public/index.html": page(
					title,
					`	<h1>${escape(title)}</h1>
	<form id="add"><input name="text" placeholder="Something to keep" /> <button>Add</button></form>
	<ul id="items"></ul>
	<script>
		// Relative to the app's own address, so it works under /app/<name>/.
		const draw = (items) => (document.getElementById("items").innerHTML = items.map((one) => \`<li>\${one.text.replace(/</g, "&lt;")}</li>\`).join(""));
		fetch("api/items").then((r) => r.json()).then(draw);
		document.getElementById("add").onsubmit = async (event) => {
			event.preventDefault();
			const text = event.target.text.value.trim();
			if (!text) return;
			event.target.reset();
			draw(await (await fetch("api/items", { method: "POST", body: JSON.stringify({ text }) })).json());
		};
	</script>`,
					`	<style>${STYLE}</style>\n`,
				),
			};
		case "solid":
			return {
				"app.json": json({ title, kind: "build", root: "dist" }),
				"package.json": json({ name: "app", private: true, type: "module", scripts: { build: "vite build", dev: "vite" }, dependencies: { "solid-js": "^1.9.0" }, devDependencies: { vite: "^6.0.0", "vite-plugin-solid": "^2.11.0" } }),
				"vite.config.js": `import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// base "./": the built files ask for each other relatively, since the app is served under /app/<name>/.
export default defineConfig({ plugins: [solid()], base: "./" });
`,
				"index.html": page(title, `	<div id="root"></div>\n	<script type="module" src="/src/index.jsx"></script>`, `	<style>${STYLE}</style>\n`),
				"src/index.jsx": `import { createSignal } from "solid-js";
import { render } from "solid-js/web";

function App() {
	const [count, setCount] = createSignal(0);
	return (
		<main>
			<h1>${escape(title)}</h1>
			<button onClick={() => setCount(count() + 1)}>Pressed {count()} times</button>
		</main>
	);
}

render(() => <App />, document.getElementById("root"));
`,
			};
		case "react":
			return {
				"app.json": json({ title, kind: "build", root: "dist" }),
				"package.json": json({ name: "app", private: true, type: "module", scripts: { build: "vite build", dev: "vite" }, dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" }, devDependencies: { vite: "^6.0.0", "@vitejs/plugin-react": "^4.3.0" } }),
				"vite.config.js": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./": the built files ask for each other relatively, since the app is served under /app/<name>/.
export default defineConfig({ plugins: [react()], base: "./" });
`,
				"index.html": page(title, `	<div id="root"></div>\n	<script type="module" src="/src/main.jsx"></script>`, `	<style>${STYLE}</style>\n`),
				"src/main.jsx": `import { useState } from "react";
import { createRoot } from "react-dom/client";

function App() {
	const [count, setCount] = useState(0);
	return (
		<main>
			<h1>${escape(title)}</h1>
			<button onClick={() => setCount(count + 1)}>Pressed {count} times</button>
		</main>
	);
}

createRoot(document.getElementById("root")).render(<App />);
`,
			};
		case "next":
			return {
				// prefix: Next.js is told its base path and expects to see it in every request.
				"app.json": json({ title, kind: "server", build: "npm run build", start: "npm start", prefix: true }),
				"package.json": json({ name: "app", private: true, scripts: { build: "next build", start: "next start -p $PORT -H 127.0.0.1", dev: "next dev -p $PORT -H 127.0.0.1" }, dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" } }),
				"next.config.mjs": `// Decks serves the app under /app/<name>/ and says so in BASE_PATH, at build time and at start.
export default { basePath: process.env.BASE_PATH ?? "" };
`,
				"app/layout.jsx": `import "./globals.css";

export const metadata = { title: ${JSON.stringify(title)} };
export const viewport = { width: "device-width", initialScale: 1 };

export default function Layout({ children }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
`,
				"app/globals.css": STYLE,
				"app/page.jsx": `export default function Page() {
	return (
		<main>
			<h1>${escape(title)}</h1>
			<p>Rendered on the server at {new Date().toLocaleTimeString()}.</p>
		</main>
	);
}
`,
			};
	}
}

const json = (value: unknown) => `${JSON.stringify(value, null, "\t")}\n`;

/** Write a starter into an empty or missing folder; refuses one that has files, which are somebody's app. */
export function writeStarter(folder: string, starter: Starter, title: string): string[] {
	if (existsSync(folder) && readdirSync(folder).length > 0) throw new Error(`${folder} already has files in it; an app is made in a new folder.`);
	const written: string[] = [];
	for (const [path, text] of Object.entries(files(starter, title))) {
		const file = join(folder, path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, text);
		written.push(path);
	}
	return written;
}
