import type { AppKind } from "./manifest.ts";

// What app.create starts from: the fewest files that run, with addresses
// relative to /app/<name>/ and a server that listens on the PORT it is given.

export const STARTERS = ["static", "node", "solid", "react", "next"] as const;
export type Starter = (typeof STARTERS)[number];
export const STARTER_KIND: Record<Starter, AppKind> = { static: "static", node: "server", solid: "build", react: "build", next: "server" };

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (value: unknown) => `${JSON.stringify(value, null, "\t")}\n`;

const STYLE = `:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0 auto; max-width: 960px; padding: clamp(16px, 4vw, 32px); line-height: 1.5; }
h1 { font-size: clamp(22px, 5vw, 28px); margin: 0 0 12px; }
button, input, select, textarea { font: inherit; min-height: 44px; }
button { padding: 0 16px; }
`;

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

const NODE_SERVER = `// Node's own http module, a folder of pages and a JSON file; no packages to install.
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
`;

const nodeList = (title: string) => `	<h1>${escape(title)}</h1>
	<form id="add"><input name="text" placeholder="Something to keep" /> <button>Add</button></form>
	<ul id="items"></ul>
	<script>
		const draw = (items) => (document.getElementById("items").innerHTML = items.map((one) => \`<li>\${one.text.replace(/</g, "&lt;")}</li>\`).join(""));
		fetch("api/items").then((r) => r.json()).then(draw);
		document.getElementById("add").onsubmit = async (event) => {
			event.preventDefault();
			const text = event.target.text.value.trim();
			if (!text) return;
			event.target.reset();
			draw(await (await fetch("api/items", { method: "POST", body: JSON.stringify({ text }) })).json());
		};
	</script>`;

const STATIC_JS = `// Served as it is: no build. Addresses are relative, since the app lives under /app/<name>/.
let count = Number(localStorage.getItem("count") ?? 0);
const show = () => (document.getElementById("count").textContent = \`Pressed \${count} times.\`);
document.getElementById("press").onclick = () => {
	count += 1;
	localStorage.setItem("count", String(count));
	show();
};
show();
`;

const vite = (plugin: string, from: string) => `import { defineConfig } from "vite";
import ${plugin} from "${from}";

// base "./": the built files ask for each other relatively, since the app is served under /app/<name>/.
export default defineConfig({ plugins: [${plugin}()], base: "./" });
`;

const counter = (title: string, react: boolean) => `import { ${react ? "useState" : "createSignal"} } from "${react ? "react" : "solid-js"}";
import { ${react ? "createRoot" : "render"} } from "${react ? "react-dom/client" : "solid-js/web"}";

function App() {
	const [count, setCount] = ${react ? "useState" : "createSignal"}(0);
	return (
		<main>
			<h1>${escape(title)}</h1>
			<button onClick={() => setCount(${react ? "count" : "count()"} + 1)}>Pressed {${react ? "count" : "count()"}} times</button>
		</main>
	);
}

${react ? `createRoot(document.getElementById("root")).render(<App />);` : `render(() => <App />, document.getElementById("root"));`}
`;

function viteApp(title: string, react: boolean): Record<string, string> {
	const deps = react ? { react: "^19.0.0", "react-dom": "^19.0.0" } : { "solid-js": "^1.9.0" };
	const dev = react ? { vite: "^6.0.0", "@vitejs/plugin-react": "^4.3.0" } : { vite: "^6.0.0", "vite-plugin-solid": "^2.11.0" };
	return {
		"app.json": json({ title, kind: "build", root: "dist" }),
		"package.json": json({ name: "app", private: true, type: "module", scripts: { build: "vite build", dev: "vite" }, dependencies: deps, devDependencies: dev }),
		"vite.config.js": react ? vite("react", "@vitejs/plugin-react") : vite("solid", "vite-plugin-solid"),
		"index.html": page(title, `	<div id="root"></div>\n	<script type="module" src="/src/main.jsx"></script>`, `	<style>${STYLE}</style>\n`),
		"src/main.jsx": counter(title, react),
	};
}

const NEXT_LAYOUT = (title: string) => `import "./globals.css";

export const metadata = { title: ${JSON.stringify(title)} };

export default function Layout({ children }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
`;

/** The files of a starter, by path inside the app. */
export function starterFiles(starter: Starter, title: string): Record<string, string> {
	switch (starter) {
		case "static":
			return {
				"app.json": json({ title, kind: "static" }),
				"index.html": page(title, `	<h1>${escape(title)}</h1>\n	<p id="count">Pressed 0 times.</p>\n	<button id="press">Press</button>\n	<script src="app.js"></script>`, `	<link rel="stylesheet" href="style.css" />\n	<!-- On the canvas: browser storage in a sandboxed frame, and wheels it cannot use go to the canvas. -->\n	<script src="decks-canvas.js"></script>\n`),
				"style.css": STYLE,
				"app.js": STATIC_JS,
			};
		case "node":
			return {
				"app.json": json({ title, kind: "server", start: "node server.js" }),
				"package.json": json({ name: "app", private: true, type: "module", scripts: { start: "node server.js" } }),
				"server.js": NODE_SERVER,
				"public/index.html": page(title, nodeList(title), `	<style>${STYLE}</style>\n`),
			};
		case "solid":
			return viteApp(title, false);
		case "react":
			return viteApp(title, true);
		case "next":
			return {
				"app.json": json({ title, kind: "server", build: "npm run build", start: "npm start", prefix: true }),
				"package.json": json({ name: "app", private: true, scripts: { build: "next build", start: "next start -p $PORT -H 127.0.0.1" }, dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" } }),
				"next.config.mjs": `export default { basePath: process.env.BASE_PATH ?? "" };\n`,
				"app/layout.jsx": NEXT_LAYOUT(title),
				"app/globals.css": STYLE,
				"app/page.jsx": `export default function Page() {\n\treturn <main><h1>${escape(title)}</h1></main>;\n}\n`,
			};
	}
}
