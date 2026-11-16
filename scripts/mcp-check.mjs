#!/usr/bin/env node
/**
 * Step 2's proof: an MCP client with no deck on its disk joins a canvas under its own name and
 * builds a card with a script and data, a document and an app, by calls alone.
 *
 *     node scripts/mcp-check.mjs            # MCP_PORT=4562 by default
 *
 * A server of its own on a copy of the fixture deck, found through an address file in a temporary
 * `DECKS_HOME`, never this user's. The client is this script speaking MCP to the stdio relay
 * (`packages/sdk/mcp/server.mjs`) as Claude Code would, from a folder that is not the deck, and then
 * to the server's web address (`/mcp`). No model is involved: what is proved is the door.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.MCP_PORT ?? 4562);
const url = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const data = mkdtempSync(join(tmpdir(), "decks-e2e-mcp-"));
cpSync(join(root, "e2e", "fixture"), data, { recursive: true });
const home = mkdtempSync(join(tmpdir(), "decks-e2e-mcp-home-"));
const project = join(mkdtempSync(join(tmpdir(), "decks-e2e-mcp-project-")), "free-food");
mkdirSync(project);
const deck = join(data, "decks");

const clean = (extra) => {
	const env = { ...process.env, ...extra };
	for (const name of Object.keys(env)) if (name.startsWith("DECKS_") && !(name in extra)) delete env[name];
	delete env.PI_CODING_AGENT_DIR;
	return env;
};
function startServer() {
	return spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: join(root, "apps", "server"), env: clean({ DECKS_DATA_DIR: data, DECKS_PORT: String(PORT), DECKS_HOST: "127.0.0.1", DECKS_HOME: home, DECKS_RESUME: "0" }), stdio: "ignore" });
}
async function up(limit = 30_000) {
	const until = Date.now() + limit;
	while (Date.now() < until) {
		try {
			await fetch(`${url}/api/hello`, { signal: AbortSignal.timeout(500) });
			return;
		} catch {
			await sleep(100);
		}
	}
	throw new Error(`no server at ${url} after ${limit} ms`);
}

const results = [];
const check = (name, ok, detail) => {
	results.push(!!ok);
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${String(detail).replace(/\s+/g, " ").slice(0, 220)}` : ""}`);
};

/** An MCP client over the relay's stdio, started in a folder that is not the deck. */
function relay() {
	const child = spawn(process.execPath, [join(root, "packages", "sdk", "mcp", "server.mjs")], { cwd: project, env: clean({ DECKS_HOME: home }), stdio: ["pipe", "pipe", "inherit"] });
	let buffer = "";
	let next = 0;
	const waiting = new Map();
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		buffer += chunk;
		let end;
		while ((end = buffer.indexOf("\n")) >= 0) {
			const message = JSON.parse(buffer.slice(0, end));
			buffer = buffer.slice(end + 1);
			waiting.get(message.id)?.(message);
		}
	});
	const rpc = (method, params) =>
		new Promise((done) => {
			const id = ++next;
			waiting.set(id, done);
			child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		});
	const tool = async (name, args = {}) => {
		const answer = await rpc("tools/call", { name, arguments: args });
		return { ok: answer.result?.isError === false, text: answer.result?.content?.[0]?.text ?? JSON.stringify(answer.error) };
	};
	return { rpc, tool, stop: () => child.kill() };
}
const firstJson = (text) => {
	try {
		return JSON.parse(text.slice(0, text.lastIndexOf("}") + 1).replace(/\}\n[^{[]*$/s, "}"));
	} catch {
		// The value, then notes: take the value's own lines.
		const lines = text.split("\n");
		for (let end = lines.length; end > 0; end--) {
			try {
				return JSON.parse(lines.slice(0, end).join("\n"));
			} catch {}
		}
		return undefined;
	}
};

let server = startServer();
let client;
try {
	await up();
	client = relay();
	const init = await client.rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.0" }, capabilities: {} });
	check("the relay finds the server, signs in and joins: the brief says who it is here", /You are connected to Decks/.test(init.result?.instructions ?? "") && /You are on this deck as "Claude Code · free-food"/.test(init.result.instructions), init.result?.instructions?.split("\n").at(-1));
	const tools = (await client.rpc("tools/list")).result.tools;
	check("the tool list is short and still reaches every call", tools.length < 40 && tools.some((one) => one.name === "decks_call") && tools.some((one) => one.name === "decks_help"), `${tools.length} tools, ${Math.round(JSON.stringify(tools).length / 1024)} KB`);

	const named = await client.tool("decks_agent_update", { patch: { name: "Finch", avatar: { emoji: "🐦" }, workspace: "free-food", tags: ["mcp proof"] } });
	check("it says who it is", named.ok && firstJson(named.text)?.kind === "outside", named.text);

	// A card with a script and data, the client holding no file of the deck.
	const made = await client.tool("decks_card_create", { options: { title: "Free food peaks on Thursdays" } });
	const path = firstJson(made.text)?.path;
	check("card.create makes a blank card on its home canvas", made.ok && typeof path === "string", made.text);
	const folder = path.replace(/\/index\.html$/, "");
	const wroteData = await client.tool("decks_file_write", { path: `${folder}/data.json`, text: JSON.stringify({ days: ["Mon", "Tue", "Wed", "Thu", "Fri"], events: [12, 18, 21, 34, 9] }) });
	const wroteCard = await client.tool("decks_file_write", {
		path,
		text: `<title>Free food peaks on Thursdays</title>\n<meta name="card" content='{"w":800}' />\n<style>.doc { padding: 32px 40px; font-size: 17px } .bars { display: flex; gap: 12px; align-items: flex-end; height: 200px } .bars i { flex: 1; background: var(--b-accent); border-radius: 6px 6px 0 0 }</style>\n<div class="doc" data-id="doc"><h1>Free food peaks on Thursdays</h1><div class="bars" data-bars></div></div>\n<script type="module">\n\texport default async function (card) {\n\t\tconst data = await (await fetch(card.file("data.json"), { signal: card.signal })).json();\n\t\tconst most = Math.max(...data.events);\n\t\tcard.root.querySelector("[data-bars]").innerHTML = data.events.map((count, index) => '<i title="' + data.days[index] + ": " + count + '" style="height:' + Math.round((count / most) * 100) + '%"></i>').join("");\n\t}\n</script>\n`,
	});
	check("file.write writes the card's page and its data with no disk", wroteData.ok && wroteCard.ok && existsSync(join(deck, folder, "data.json")) && /data-bars/.test(readFileSync(join(deck, path), "utf8")), wroteCard.text);
	const edited = await client.tool("decks_file_edit", { path, edits: [{ find: "<h1>Free food peaks on Thursdays</h1>", replace: "<h1>Free food peaks on Thursdays, at 34 events</h1>" }] });
	const read = await client.tool("decks_file_read", { path, options: { lines: 4 } });
	check("file.edit changes it and file.read reads it back", edited.ok && read.ok && /at 34 events/.test(readFileSync(join(deck, path), "utf8")) && firstJson(read.text)?.more === true, read.text);
	const placed = await client.tool("decks_canvas_insert", { item: { type: "card", card: path }, options: { at: { x1: 0, y1: 0 } } });
	check("canvas.insert places the card", placed.ok && firstJson(placed.text)?.type === "card", placed.text);
	const onCanvas = await client.tool("decks_canvas_read", {});
	check("canvas.read shows it on the canvas", onCanvas.ok && onCanvas.text.includes(path));

	// A document and an app, by calls alone.
	const doc = await client.tool("decks_file_write", { path: "papers/free-food-notes.md", text: "# Free food notes\n\nThursday is the day.\n" });
	const docPlaced = await client.tool("decks_canvas_insert", { item: { type: "document", path: "papers/free-food-notes.md" }, options: { beside: path } });
	check("a document is written and placed", doc.ok && docPlaced.ok, docPlaced.text);
	const app = await client.tool("decks_call", { name: "apps.create", args: { name: "mcp-proof", options: { starter: "static", title: "MCP proof" } } });
	const appPage = await client.tool("decks_file_write", { path: "apps/mcp-proof/index.html", text: "<!doctype html><title>MCP proof</title><h1>Built over MCP</h1>\n" });
	const appPlaced = await client.tool("decks_canvas_insert", { item: { type: "app", app: "mcp-proof" }, options: { below: path } });
	check("an app is made through decks_call, written and placed", app.ok && appPage.ok && appPlaced.ok && /Built over MCP/.test(readFileSync(join(deck, "apps", "mcp-proof", "index.html"), "utf8")), `${app.text.slice(0, 80)} … ${appPlaced.text.slice(0, 80)}`);

	const refused = await client.tool("decks_file_read", { path: ".decks/tokens.json" });
	const escaped = await client.tool("decks_file_write", { path: "../outside.txt", text: "x" });
	check("the file calls refuse a hidden folder and a path out of the deck", !refused.ok && !escaped.ok && !existsSync(join(data, "outside.txt")), refused.text);

	// The person's side: it is in the agents list as an outside agent, and what they write reaches it.
	const token = () => JSON.parse(readFileSync(join(data, ".decks", "cli-token"), "utf8")).token;
	const asPerson = async (verb, args) => (await (await fetch(`${url}/api/v1/${verb}`, { method: "POST", headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" }, body: JSON.stringify({ args }) })).json()) ?? {};
	const row = (await asPerson("agent.list", [])).value?.find((one) => one.name === "Finch");
	check("the person's agents list has it, marked as working in Claude Code", row?.kind === "outside" && row.outside?.client === "Claude Code", JSON.stringify(row));
	const sent = await asPerson("agent.send", ["Finch", { task: "Make the Thursday bar red, please." }]);
	check("a message to it waits, since Decks cannot start its turn", sent.value?.delivered === false && sent.value?.turn === "queued", JSON.stringify(sent.value));
	const next = await client.tool("decks_here", {});
	check("the message arrives with its next tool call", next.ok && /News from Decks/.test(next.text) && /Make the Thursday bar red/.test(next.text), next.text);
	const again = await client.tool("decks_agent_news", {});
	check("and is not delivered twice", again.ok && firstJson(again.text)?.messages?.length === 0, again.text);

	// A restart under the session: the next call waits it out, and it is the same agent.
	const before = firstJson((await client.tool("decks_agent_me", {})).text)?.id;
	server.kill("SIGKILL");
	await new Promise((done) => server.once("exit", done));
	server = startServer();
	const after = await client.tool("decks_agent_me", {});
	check("after a server restart the same session goes on as the same agent", after.ok && firstJson(after.text)?.id === before && firstJson(after.text)?.name === "Finch", after.text);

	// A second session from the same folder is the same agent; from the web address, one of its own.
	client.stop();
	client = relay();
	const back = await client.rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code" }, capabilities: {} });
	check("a new session from the same folder comes back as the same agent", /You are on this deck as "Finch"/.test(back.result?.instructions ?? "") && /You have been here before/.test(back.result.instructions), back.result?.instructions?.split("\n").at(-1));

	const http = async (body, session) => {
		const response = await fetch(`${url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token()}`, "content-type": "application/json", accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify(body) });
		return { status: response.status, session: response.headers.get("mcp-session-id"), body: response.status === 202 ? undefined : await response.json().catch(() => undefined) };
	};
	const opened = await http({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-ai", title: "Claude" }, capabilities: {} } });
	const me = await http({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "decks_agent_me", arguments: {} } }, opened.session);
	check("the web address opens a session that joins as an agent of its own", opened.status === 200 && !!opened.session && /no disk in common/.test(opened.body?.result?.instructions ?? "") && firstJson(me.body?.result?.content?.[0]?.text ?? "")?.kind === "outside", me.body?.result?.content?.[0]?.text);
	const resources = await http({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: `decks://card/${path}` } }, opened.session);
	check("and reads the card the first client wrote", /at 34 events/.test(resources.body?.result?.contents?.[0]?.text ?? ""));
	const noToken = await fetch(`${url}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
	check("without a token the web address answers 401", noToken.status === 401);
} catch (error) {
	check("the check ran", false, error?.stack ?? String(error));
} finally {
	client?.stop();
	server.kill("SIGKILL");
	for (const dir of [data, home, dirname(project)]) rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
