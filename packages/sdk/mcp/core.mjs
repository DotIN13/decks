/**
 * The MCP door, whatever carries it: every Decks call as a tool, the deck as things to read, the
 * skills as prompts, and the brief an agent gets when it connects.
 *
 * One JSON-RPC message in, its answer out (`handle`), with no transport in it: the stdio relay a
 * local client starts (`server.mjs`) and the server's own web address (`/mcp`, `apps/server`) both
 * run this. What it needs from its host is `call`, one Decks call made as whoever the session is.
 *
 * The tool list is short unless asked otherwise: the calls used every day in full, and two more that
 * reach the rest (`decks_help`, `decks_call`), since every tool's description is read by the model
 * at the start of each session. `tools` widens it: "all", or groups and names ("canvas,card,file").
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const VERSION = "0.3.0";
/** The protocol versions this speaks, newest first; a client asking for another gets the newest. */
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const toolName = (verb) => `decks_${verb.name.replace(/\./g, "_")}`;

/**
 * The calls listed in full by default: what making and reading a canvas takes, day to day.
 * `canvas.batch` is left to `decks_call`: its description alone is a quarter of this list's size.
 */
export const EVERYDAY = new Set([
	"here", "canvas.list", "canvas.create", "canvas.rename", "canvas.read", "canvas.space", "canvas.insert", "canvas.update", "canvas.replace", "canvas.delete", "canvas.move", "canvas.fit", "canvas.screenshot",
	"card.list", "card.create", "card.get",
	"file.list", "file.find", "file.read", "file.write", "file.edit", "file.grep", "file.url",
	"agent.me", "agent.update", "agent.news", "agent.list", "agent.send",
	"view.goto", "view.focus",
]);

const toolOf = (verb) => ({
	name: toolName(verb),
	description: `${verb.summary}\n\n${verb.signature}: ${verb.returns}`,
	inputSchema: {
		type: "object",
		properties: Object.fromEntries(verb.params.map((param) => [param.name, param.schema])),
		...(verb.params.some((param) => !param.optional) ? { required: verb.params.filter((param) => !param.optional).map((param) => param.name) } : {}),
		additionalProperties: false,
	},
});

const HELP = {
	name: "decks_help",
	description: "Every Decks call, by group, with a line each; or with `name` (as in canvas.export, or apps), that call's or group's full description, signature and arguments. The calls not listed as tools of their own are run with decks_call.",
	inputSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false },
};
const CALL = {
	name: "decks_call",
	description: 'Run any Decks call by name, for the ones that have no tool of their own: `name` as in "canvas.export" or "apps.create", and `args`, an object keyed by the call\'s argument names (decks_help says them) or a list in order.',
	inputSchema: { type: "object", properties: { name: { type: "string" }, args: {} }, required: ["name"], additionalProperties: false },
};

/** Which calls are tools of their own: the everyday ones, or what `wanted` names ("all", groups, call names). */
export function toolsFor(verbs, wanted = "") {
	const asked = String(wanted ?? "").split(",").map((one) => one.trim()).filter(Boolean);
	if (asked.includes("all")) return verbs.map(toolOf);
	// Named groups or calls: exactly those, as before, with no extras.
	if (asked.length) return verbs.filter((verb) => asked.includes(verb.group) || asked.includes(verb.name)).map(toolOf);
	return [...verbs.filter((verb) => EVERYDAY.has(verb.name)).map(toolOf), HELP, CALL];
}

/** The skills this install has, as prompts: each folder of `runtime/skills` with a SKILL.md. */
export function installedSkills(dir = fileURLToPath(new URL("../../../runtime/skills/", import.meta.url))) {
	let names;
	try {
		names = readdirSync(dir);
	} catch {
		return [];
	}
	const skills = [];
	for (const name of names.sort()) {
		let text;
		try {
			text = readFileSync(`${dir}/${name}/SKILL.md`, "utf8");
		} catch {
			continue;
		}
		const front = /^---\n([\s\S]*?)\n---\n?/.exec(text);
		const description = front ? /^description:\s*(.+)$/m.exec(front[1])?.[1]?.trim() : undefined;
		skills.push({ name, description: description ?? name, text: front ? text.slice(front[0].length).trim() : text.trim() });
	}
	return skills;
}

export const BRIEF = (() => {
	try {
		return readFileSync(new URL("./brief.md", import.meta.url), "utf8").trim();
	} catch {
		return "You are connected to Decks, a canvas the person keeps open. decks_help lists what you can do there.";
	}
})();

const text = (value) => ({ type: "text", text: value });
const asText = (value) => (value === undefined ? "(done)" : typeof value === "string" ? value : JSON.stringify(value, null, 2));

class RpcError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

/**
 * One MCP session.
 *
 * @param {object} host
 * @param {Array} host.verbs  The table, as `verbs.json` has it.
 * @param {(name: string, args: unknown[]) => Promise<{ value: unknown, notes: string[], images?: Array<{ data: string, mimeType: string }> }>} host.call  One Decks call, as this session's caller.
 * @param {string} [host.tools]  Which calls are tools of their own (`toolsFor`).
 * @param {(client: { name?: string, title?: string, version?: string } | undefined) => Promise<string | undefined>} [host.joined]  The client said who it is (`initialize`): join the canvas, and answer a line for the brief (who you are here).
 * @param {boolean} [host.news]  Add what waits for the caller (`agent.news`) to a tool's answer. For a session that is an agent.
 * @param {() => Array<{ name: string, description: string, text: string }>} [host.skills]
 */
export function createMcp(host) {
	const verbs = host.verbs;
	const byTool = new Map(verbs.map((verb) => [toolName(verb), verb]));
	const byName = new Map(verbs.map((verb) => [verb.name, verb]));
	const tools = toolsFor(verbs, host.tools);
	const skills = host.skills ?? installedSkills;

	/** A tool's input, keyed by argument name, as the list a call takes. */
	const argsOf = (verb, input) => {
		if (Array.isArray(input)) return input;
		const given = input && typeof input === "object" ? input : {};
		const unknown = Object.keys(given).filter((key) => !verb.params.some((param) => param.name === key));
		if (unknown.length) throw new Error(`${verb.name} has no argument ${unknown.map((one) => `"${one}"`).join(", ")}. It is ${verb.signature}.`);
		return verb.params.map((param) => given[param.name]);
	};

	const help = (name) => {
		const asked = typeof name === "string" ? name.trim().replace(/^decks[_.]/, "").replace(/_/g, ".") : "";
		const one = byName.get(asked);
		if (one) return [`${one.signature}: ${one.returns}`, "", one.summary, "", ...one.params.map((param) => `${param.name}${param.optional ? " (optional)" : ""}: ${param.type}`), "", byTool.has(toolName(one)) && tools.some((tool) => tool.name === toolName(one)) ? `It is the tool ${toolName(one)}.` : `Run it with decks_call { name: "${one.name}", args: { … } }.`].join("\n");
		const groups = new Map();
		for (const verb of verbs) groups.set(verb.group, [...(groups.get(verb.group) ?? []), verb]);
		const picked = groups.has(asked) ? [[asked, groups.get(asked)]] : [...groups];
		const lines = asked && !groups.has(asked) ? [`There is no call or group "${asked}". Every call:`, ""] : [];
		for (const [group, list] of picked) {
			lines.push(`${group}:`);
			for (const verb of list) lines.push(`  ${verb.name}: ${groups.has(asked) ? verb.summary : verb.summary.split(/(?<=[.:])\s/)[0]}`);
			lines.push("");
		}
		lines.push('decks_help { name: "canvas.export" } says more about one; decks_call runs any of them.');
		return lines.join("\n");
	};

	/** What waits for the caller, as lines to put under a tool's answer: asked with every call, so mail is never a call late. */
	const newsLines = async () => {
		if (!host.news) return [];
		try {
			const { value } = await host.call("agent.news", []);
			const lines = [];
			for (const message of value?.messages ?? []) lines.push(`${message.from} wrote to you${message.cards?.length ? ` (about ${message.cards.join(", ")})` : ""}: ${message.task}`);
			lines.push(...(value?.changes ?? []));
			return lines.length ? ["", "[News from Decks since your last call]", ...lines] : [];
		} catch {
			return [];
		}
	};

	async function callTool(name, input) {
		if (name === "decks_help") return [text(help(input?.name))];
		let verb = byTool.get(name);
		let args;
		if (name === "decks_call") {
			verb = byName.get(String(input?.name ?? "").trim().replace(/^decks[_.]/, ""));
			if (!verb) throw new Error(`There is no call "${input?.name}". decks_help lists them.`);
			args = argsOf(verb, input?.args);
		} else {
			if (!verb) throw new Error(`There is no tool called ${name}. decks_help lists the calls.`);
			args = argsOf(verb, input);
		}
		const { value, notes, images } = await host.call(verb.name, args);
		const news = verb.name === "agent.news" ? [] : await newsLines();
		return [text([asText(value), ...(notes ?? []), ...news].join("\n")), ...(images ?? []).map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }))];
	}

	// --- things to read: canvases, cards and files, by address ------------------------------

	const PAGE = 100;
	async function listResources(cursor) {
		const from = Number(cursor) || 0;
		const [canvases, cards] = await Promise.all([host.call("canvas.list", []), host.call("card.list", [])]);
		const all = [
			...(canvases.value ?? []).map((canvas) => ({ uri: `decks://canvas/${encodeURIComponent(canvas.name)}`, name: canvas.title || canvas.name, description: `A canvas with ${canvas.cards} card${canvas.cards === 1 ? "" : "s"}: everything on it, as decks_canvas_read answers.`, mimeType: "application/json" })),
			...(cards.value ?? []).map((card) => ({ uri: `decks://card/${card.path.split("/").map(encodeURIComponent).join("/")}`, name: card.title || card.path, description: `A card: ${card.path}`, mimeType: "text/html" })),
		];
		return { resources: all.slice(from, from + PAGE), ...(from + PAGE < all.length ? { nextCursor: String(from + PAGE) } : {}) };
	}
	const TEMPLATES = [
		{ uriTemplate: "decks://canvas/{name}", name: "A canvas", description: "Everything on a canvas, each item with its box.", mimeType: "application/json" },
		{ uriTemplate: "decks://card/{+path}", name: "A card", description: "A card's index.html, by its path in the deck.", mimeType: "text/html" },
		{ uriTemplate: "decks://file/{+path}", name: "A file", description: "A text file in the deck, by its path from the deck's root." },
	];
	async function readResource(uri) {
		const found = /^decks:\/\/(canvas|card|file)\/(.+)$/.exec(String(uri ?? ""));
		if (!found) throw new RpcError(-32002, `There is nothing to read at ${uri}. Addresses are decks://canvas/<name>, decks://card/<path> and decks://file/<path>.`);
		const rest = decodeURIComponent(found[2]);
		if (found[1] === "canvas") {
			const { value } = await host.call("canvas.read", [{ canvas: rest }]);
			return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) }] };
		}
		const { value } = await host.call("file.read", [rest]);
		return { contents: [{ uri, mimeType: /\.html?$/.test(rest) ? "text/html" : /\.json$/.test(rest) ? "application/json" : /\.md$/.test(rest) ? "text/markdown" : "text/plain", text: value.text }] };
	}

	const METHODS = {
		initialize: async (params) => {
			const who = await host.joined?.(params?.clientInfo);
			return {
				protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
				capabilities: { tools: {}, resources: {}, prompts: {} },
				serverInfo: { name: "decks", title: "Decks", version: VERSION },
				instructions: who ? `${BRIEF}\n\n${who}` : BRIEF,
			};
		},
		ping: async () => ({}),
		"tools/list": async () => ({ tools }),
		"tools/call": async (params) => {
			try {
				return { content: await callTool(params?.name, params?.arguments), isError: false };
			} catch (error) {
				// A refused call is the tool's answer, said so the model can act on it; not a fault of the protocol.
				return { content: [text([error instanceof Error ? error.message : String(error), ...(error?.notes ?? [])].join("\n"))], isError: true };
			}
		},
		"resources/list": async (params) => listResources(params?.cursor),
		"resources/templates/list": async () => ({ resourceTemplates: TEMPLATES }),
		"resources/read": async (params) => readResource(params?.uri),
		"prompts/list": async () => ({ prompts: skills().map((skill) => ({ name: skill.name, title: skill.name.replace(/-/g, " "), description: skill.description })) }),
		"prompts/get": async (params) => {
			const skill = skills().find((one) => one.name === params?.name);
			if (!skill) throw new RpcError(-32602, `There is no prompt called ${params?.name}.`);
			return { description: skill.description, messages: [{ role: "user", content: text(skill.text) }] };
		},
	};

	return {
		tools,
		/** One message's answer, or undefined for a notification, which takes none. */
		async handle(message) {
			if (!message || typeof message !== "object" || typeof message.method !== "string") return message?.id !== undefined ? { jsonrpc: "2.0", id: message.id, error: { code: -32600, message: "Not a JSON-RPC request." } } : undefined;
			if (message.id === undefined) return undefined;
			const method = METHODS[message.method];
			if (!method) return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Decks has no method ${message.method}.` } };
			try {
				return { jsonrpc: "2.0", id: message.id, result: await method(message.params) };
			} catch (error) {
				return { jsonrpc: "2.0", id: message.id, error: { code: error instanceof RpcError ? error.code : -32603, message: error instanceof Error ? error.message : String(error) } };
			}
		},
	};
}
