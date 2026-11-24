#!/usr/bin/env node
/**
 * `decks`: every Decks verb as a command, for an agent's shell and anyone else's.
 *
 *     decks canvas read | jq -r '.items[] | select(.type=="card") | .card'
 *     p=$(decks card create --title "Q3 revenue is up a fifth" | jq -r .path)
 *     decks canvas insert --type card --card "$p" --at.x1 0 --at.y1 0
 *     decks canvas fit "$p" --canvas launch-plan
 *     decks canvas delete n1
 *     echo '[...]' | decks canvas batch -
 *
 * Commands are noun then verb (`decks canvas insert`, `decks agent send`); `--canvas` names the
 * canvas, and left out it is the one `decks here` says; `--frame frames/<name>` points the item
 * calls at a frame file instead.
 *
 * A verb's plain arguments (a path, a name) are words; an object argument's keys are flags, with a
 * dot for a key inside a key (`--at.x1 0`); anything else is JSON, and `-` reads it from stdin.
 * `--args '<JSON list>'` gives every argument as JSON at once.
 *
 * The value goes to stdout: a string as it is, anything else as JSON. The notes a verb adds (what
 * `canvas fit` measured, where a card went) go to stderr, and a refusal goes to stderr with exit code 1.
 * Who is calling is the token the command carries: `DECKS_TOKEN`, which Decks sets in every agent's
 * shell and every app server's environment, or the person's, which `decks login` keeps in
 * `~/.decks/token` for each harness. Where Decks is is `DECKS_URL`, else this machine at
 * `DECKS_PORT` (4329).
 */
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { connect, DecksError } from "../src/index.js";
import { ensureServer, locate, logFiles, serverStatus, startServer, stopServer } from "../src/server.js";

const VERBS = JSON.parse(readFileSync(new URL("../src/verbs.json", import.meta.url), "utf8"));

/** Where Decks is: `DECKS_URL`, else this machine at `DECKS_PORT`, else what the server wrote in `~/.decks/server.json` (`src/server.js`). */
function harness() {
	return locate().url;
}

/**
 * `decks server [status|start|stop|restart|logs]`: this user's Decks, found through the address
 * file. `logs [n]` prints the last n lines (40) of what it wrote.
 */
async function server(words) {
	const what = words[0] ?? "status";
	if (what === "status") {
		const status = await serverStatus();
		out(JSON.stringify(status, null, 2));
		return status.running ? 0 : 1;
	}
	if (what === "start") {
		const started = await startServer();
		err(started.started ? `Decks is at ${started.url}: ${started.how}.` : `Decks is at ${started.url}: ${started.how}.`);
		return 0;
	}
	if (what === "stop") {
		const stopped = await stopServer();
		err(stopped.stopped ? `Stopped Decks (process ${stopped.pid}).${stopped.note ? ` ${stopped.note}` : ""}` : stopped.why);
		return stopped.stopped ? 0 : 1;
	}
	if (what === "restart") {
		const stopped = await stopServer();
		if (!stopped.stopped && !/No running Decks/.test(stopped.why ?? "")) {
			err(stopped.why);
			return 1;
		}
		const started = await startServer();
		err(`Decks is at ${started.url}: ${started.how}.`);
		return 0;
	}
	if (what === "logs") {
		const count = Number(words[1]) > 0 ? Number(words[1]) : 40;
		for (const file of await logFiles()) {
			let text;
			try {
				text = readFileSync(file, "utf8");
			} catch {
				err(`${file}: nothing there yet.`);
				continue;
			}
			err(`${file}:`);
			out(text.trimEnd().split("\n").slice(-count).join("\n"));
		}
		return 0;
	}
	err(`decks server: no "${what}". It takes status, start, stop, restart or logs.`);
	return 1;
}

/** The connection a command calls through: its token is the SDK's to find (`DECKS_TOKEN`, then `~/.decks/token`). */
function caller() {
	return { notes: () => {}, url: harness() };
}

/** `~/.decks/token`: a harness's address to the person token `decks login` got from it. */
const tokenFile = () => join(process.env.DECKS_HOME || join(homedir(), ".decks"), "token");

function readTokens() {
	try {
		const saved = JSON.parse(readFileSync(tokenFile(), "utf8"));
		return saved && typeof saved === "object" ? saved : {};
	} catch {
		return {};
	}
}

/** Keep the tokens where only this user reads them. */
function writeTokens(tokens) {
	const file = tokenFile();
	mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
	writeFileSync(file, `${JSON.stringify(tokens, null, "\t")}\n`, { mode: 0o600 });
	chmodSync(file, 0o600);
}

/**
 * The token a harness on this machine wrote for its own user at start (`<data dir>/.decks/cli-token`,
 * `server/src/auth/cli-token.ts`): the data folder is `DECKS_DATA_DIR`, else `~/.decks`, as the
 * harness's own default. Undefined when there is none to read.
 */
function cliToken() {
	const dataDir = process.env.DECKS_DATA_DIR || join(homedir(), ".decks");
	const file = join(dataDir.replace(/^~(?=\/|$)/, homedir()), ".decks", "cli-token");
	try {
		const saved = JSON.parse(readFileSync(file, "utf8"));
		return typeof saved?.token === "string" ? { file, token: saved.token, url: typeof saved.url === "string" ? saved.url : undefined } : { file };
	} catch {
		return { file };
	}
}

/**
 * Whether the harness this command calls is the one that wrote the file: the same address, or this
 * machine at the same port. The token is never sent anywhere else, so a `DECKS_URL` that points at
 * another server does not carry this machine's token there.
 */
function sameHarness(written) {
	if (!written) return false;
	try {
		const [a, b] = [new URL(written), new URL(harness())];
		if (a.origin === b.origin) return true;
		const loopback = (url) => /^(?:127\.\d+\.\d+\.\d+|localhost|\[::1\])$/.test(url.hostname);
		return loopback(a) && loopback(b) && a.port === b.port && a.protocol === b.protocol;
	} catch {
		return false;
	}
}

/** Trade a code, or the harness's own token for this user, for a terminal's person token. */
async function trade(body, bearer) {
	let response;
	try {
		response = await fetch(`${harness()}/api/login`, { method: "POST", headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify({ ...body, label: `decks login on ${hostname()}` }) });
	} catch (error) {
		throw new DecksError(`Could not reach Decks at ${harness()}: ${error.message}`);
	}
	const answer = await response.json().catch(() => ({}));
	return { ok: response.ok && typeof answer.token === "string", status: response.status, answer };
}

/**
 * `decks login [code]`: the person at a terminal. With a code, one `decks pair code` made on the
 * harness's machine (an agent can run it, in its shell). With none, on the harness's own machine as
 * the user it runs as: the token it wrote for that user (`cliToken`) is the proof, and is traded for
 * the terminal's own. Asked for a code only when neither works and there is someone to ask.
 */
async function login(words) {
	let code = words.find((word) => !/^https?:\/\//.test(word) && /\d/.test(word))?.replace(/\D/g, "") ?? "";
	// A harness locked with a password (`auth/password.ts`), reached from elsewhere: let in from a logged-in browser rather than by a code.
	if (!code && (words.some((word) => /^https?:\/\//.test(word)) || !cliToken().token) && (await passwordSet())) return deviceLogin();
	if (!code) {
		const local = cliToken();
		if (local.token && !sameHarness(local.url)) {
			if (!process.stdin.isTTY) throw new DecksError(`The token in ${local.file} is for ${local.url ?? "another harness"}, not ${harness()}: set DECKS_DATA_DIR to this harness's data folder (or DECKS_URL/DECKS_PORT to that harness), or log in with a code, decks login 123456, made with decks pair code on its machine.`);
		} else if (local.token) {
			const traded = await trade({}, local.token);
			if (traded.ok) {
				writeTokens({ ...readTokens(), [harness()]: traded.answer.token });
				return `Logged in to ${traded.answer.name ?? harness()} with the token it keeps for you in ${local.file}. The terminal's token is in ${tokenFile()}.`;
			}
			if (!process.stdin.isTTY) throw new DecksError(`${harness()} did not take the token in ${local.file}${local.url && local.url !== harness() ? ` (it is for ${local.url})` : ""}: set DECKS_DATA_DIR to this harness's data folder, or log in with a code, decks login 123456, made with decks pair code on its machine.`);
		} else if (!process.stdin.isTTY) {
			throw new DecksError(`No code, and no token in ${local.file} to log in with: run decks login on the harness's own machine as its user (DECKS_DATA_DIR names its data folder), or give a code, decks login 123456, made with decks pair code there.`);
		}
		const ask = createInterface({ input: process.stdin, output: process.stderr });
		code = (await ask.question(`Code for ${harness()} (from decks pair code): `)).replace(/\D/g, "");
		ask.close();
	}
	const traded = await trade({ code });
	if (!traded.ok) throw new DecksError(traded.answer.error || `Decks answered ${traded.status}`);
	writeTokens({ ...readTokens(), [harness()]: traded.answer.token });
	return `Logged in to ${traded.answer.name ?? harness()}. The token is in ${tokenFile()}.`;
}

/** Whether the harness is locked with a password: then a terminal elsewhere is let in from a browser. */
async function passwordSet() {
	try {
		const state = await (await fetch(`${harness()}/api/login/state`)).json();
		return state.enabled === true && state.password === true;
	} catch {
		return false;
	}
}

/**
 * `decks login https://host` on a Decks locked with a password: the harness gives a code and a link,
 * the person opens the link in a browser where they are logged in and presses Approve, and this asks
 * every two seconds until it is given the terminal's token. No password is typed here.
 */
async function deviceLogin() {
	const post = (path, body) => fetch(`${harness()}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	const started = await (await post("/api/login/device", { label: `decks login on ${hostname()}` })).json();
	if (!started.id) throw new DecksError(started.error || `Decks at ${harness()} did not start a login.`);
	err(`To let this terminal in, open ${harness()}${started.url}\nin a browser where you are logged in to Decks, check the code is ${started.code}, and press Approve.`);
	while (Date.now() < started.expires) {
		await new Promise((resolve) => setTimeout(resolve, 2000));
		const response = await post("/api/login/device/poll", { id: started.id });
		const answer = await response.json().catch(() => ({}));
		if (response.status === 410) break;
		if (answer.token) {
			writeTokens({ ...readTokens(), [harness()]: answer.token });
			return `Logged in to ${answer.name ?? harness()}. The token is in ${tokenFile()}${process.env.DECKS_URL ? `; set DECKS_URL=${harness()} for the commands that follow` : ""}.`;
		}
	}
	throw new DecksError("Nobody approved this login in time. Run decks login again.");
}

/** A line typed at the terminal without showing it: raw mode before the prompt, so nothing typed early is echoed. */
function askHidden(prompt) {
	if (!process.stdin.isTTY) throw new DecksError("decks password set reads the password from a terminal, typed twice.");
	process.stdin.setRawMode(true);
	process.stderr.write(prompt);
	return new Promise((resolve, reject) => {
		let typed = "";
		const done = (error) => {
			process.stdin.off("data", onData);
			process.stdin.setRawMode(false);
			process.stdin.pause();
			process.stderr.write("\n");
			if (error) reject(error);
			else resolve(typed);
		};
		const onData = (chunk) => {
			for (const char of chunk.toString("utf8")) {
				if (char === "\r" || char === "\n") return done();
				if (char === "\u0003") return done(new DecksError("Cancelled."));
				if (char === "\u007f" || char === "\b") typed = typed.slice(0, -1);
				else typed += char;
			}
		};
		process.stdin.on("data", onData);
		process.stdin.resume();
	});
}

/**
 * `decks password set` and `decks password remove`, on the harness's own machine: the token the harness
 * keeps for its own user is the proof (`cli-token.ts`), so no old password is asked. With a password
 * set, a browser logs in before the page gives it access (`auth/password.ts`).
 */
async function password(words) {
	const local = cliToken();
	if (!local.token || !sameHarness(local.url)) throw new DecksError(`decks password works on the harness's own machine, as the user it runs as: it reads the token the harness keeps in ${local.file}. From elsewhere, change the password in Settings, Accounts.`);
	const what = words[0] ?? "set";
	let body;
	if (what === "remove") body = { password: null };
	else if (what === "set") {
		const first = await askHidden("New password (10 characters or more): ");
		const again = await askHidden("The same again: ");
		if (first !== again) throw new DecksError("The two did not match. Nothing changed.");
		body = { password: first };
	} else throw new DecksError("decks password set, or decks password remove.");
	const response = await fetch(`${harness()}/api/password`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${local.token}` }, body: JSON.stringify(body) });
	const answer = await response.json().catch(() => ({}));
	if (!response.ok) throw new DecksError(answer.error || `Decks answered ${response.status}`);
	const on = await fetch(`${harness()}/api/login/state`).then((r) => r.json()).then((state) => state.enabled === true, () => false);
	if (!answer.password) return on ? "The password is taken away. The password login is still on (DECKS_PASSWORD_LOGIN), so nothing opens until one is set again." : "The password is taken away.";
	return on
		? `The password is set. A browser now logs in at ${harness()}/login before Decks opens, and terminals elsewhere log in with decks login ${harness()}.`
		: "The password is set, but the password login is off: start Decks with DECKS_PASSWORD_LOGIN=1 to ask for it.";
}

/** `decks logout`: the harness takes the token back, and it is gone from `~/.decks/token`. */
async function logout() {
	const tokens = readTokens();
	const token = tokens[harness()];
	if (!token) return `Not logged in to ${harness()}.`;
	await fetch(`${harness()}/api/session`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
	delete tokens[harness()];
	writeTokens(tokens);
	return `Logged out of ${harness()}.`;
}

const out = (text) => process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
const err = (text) => process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);

/** The verb a command line names, and the words after it: `canvas read x` -> canvas.read, [x]. */
export function verbOf(words) {
	for (const take of [2, 1]) {
		const command = words.slice(0, take);
		const verb = VERBS.find((one) => one.command.join(" ") === command.join(" "));
		if (verb) return { verb, rest: words.slice(take) };
	}
	return undefined;
}

export function help(verb) {
	if (verb) {
		const lines = [`decks ${verb.command.join(" ")}`, "", `  ${verb.signature}: ${verb.returns}`, "", wrap(verb.summary, "  "), ""];
		for (const param of verb.params) lines.push(`  ${param.name}${param.optional ? " (optional)" : ""}: ${param.type}`);
		const objects = verb.params.filter((param) => param.schema.type === "object" && param.schema.properties);
		if (objects.length) lines.push("", `  Flags: ${objects.flatMap((param) => Object.keys(param.schema.properties).map((key) => `--${key}`)).join(" ")}`);
		return lines.join("\n");
	}
	const groups = new Map();
	for (const one of VERBS) groups.set(one.group, [...(groups.get(one.group) ?? []), one]);
	const lines = [
		"decks <noun> <verb> [arguments] [--flags]: every Decks call, as a command.",
		"",
		"Each prints its value to stdout (JSON, or a string as it is) and its notes to stderr. --canvas names the canvas; left out, it is decks here. The item calls (read, insert, update, replace, delete, move, copy, variables, batch) take --frame frames/<name> instead, to edit a frame file.",
		"",
	];
	for (const [group, verbs] of groups) {
		lines.push(`${group}:`);
		for (const one of verbs) lines.push(`  ${one.command.join(" ").padEnd(18)} ${firstSentence(one.summary)}`);
		lines.push("");
	}
	lines.push("decks events [type…] prints every change as it happens, one JSON line each.");
	lines.push("decks mcp is Decks as an MCP server for Claude Code, Codex or Cursor (claude mcp add decks -- decks mcp): it finds or starts Decks, and joins the canvas as an agent named for the client and its folder.");
	lines.push("decks server [status|start|stop|restart|logs] finds this user's Decks and starts or stops it. A command at a terminal starts it by itself when none is running.");
	lines.push("decks login [code] signs this terminal in as the person: with no code on the harness's own machine, else with a code from decks pair code; decks logout signs it out.");
	lines.push("decks login https://host signs in to a Decks locked with a password: approve it in a browser where you are logged in. decks password set (or remove), on the harness's machine, sets the password a browser logs in with.");
	lines.push("decks help <command> says more about one. DECKS_URL says where Decks is; DECKS_TOKEN, or the token decks login kept, says who is calling.");
	return lines.join("\n");
}

const firstSentence = (text) => {
	const end = text.search(/[.:](\s|$)/);
	return end > 0 ? text.slice(0, end + 1) : text;
};

function wrap(text, indent) {
	const lines = [];
	let line = "";
	for (const word of text.split(/\s+/)) {
		if (line && line.length + word.length > 92) {
			lines.push(indent + line);
			line = word;
		} else line = line ? `${line} ${word}` : word;
	}
	if (line) lines.push(indent + line);
	return lines.join("\n");
}

let stdin;
const readStdin = () => (stdin ??= readFileSync(0, "utf8"));

/** A word as the shape wants it: JSON for anything but a string, `-` for stdin. */
function valueOf(word, schema) {
	if (word === "-") word = readStdin().trim();
	const wantsString = schema && (schema.type === "string" || (schema.enum && schema.enum.every((one) => typeof one === "string")));
	if (wantsString) return word;
	if (schema && (schema.type === "number" || schema.type === "integer")) {
		const number = Number(word);
		return Number.isFinite(number) ? number : word;
	}
	if (schema && schema.type === "boolean") return word === "true" ? true : word === "false" ? false : word;
	try {
		return JSON.parse(word);
	} catch {
		return word;
	}
}

/** The schema of a dotted key inside an object schema, or nothing. */
function schemaAt(schema, keys) {
	let here = schema;
	for (const key of keys) {
		const options = here?.anyOf ?? [here];
		here = options.map((one) => one?.properties?.[key]).find(Boolean);
		if (!here) return undefined;
	}
	return here;
}

/** The arguments a command line gives a verb, as the list the verb takes. */
export function argsOf(verb, words) {
	const args = new Array(verb.params.length).fill(undefined);
	const positional = [];
	const flags = [];
	for (let index = 0; index < words.length; index++) {
		const word = words[index];
		if (word.startsWith("--") && word.length > 2) {
			const eq = word.indexOf("=");
			const key = eq > 0 ? word.slice(2, eq) : word.slice(2);
			let value = eq > 0 ? word.slice(eq + 1) : words[index + 1];
			if (eq < 0) {
				if (value === undefined || (value.startsWith("--") && value.length > 2)) value = "true";
				else index++;
			}
			flags.push([key, value]);
		} else positional.push(word);
	}

	const asJson = flags.find(([key]) => key === "args");
	if (asJson) return JSON.parse(asJson[1] === "-" ? readStdin() : asJson[1]);

	// Flags fill the first object parameter that has the key, else the first that takes any key (a record such as canvas.variables' set).
	const objects = verb.params.map((param, index) => [param, index]).filter(([param]) => param.schema.type === "object" || param.schema.anyOf?.some((one) => one.type === "object"));
	const open = (schema) => (schema.anyOf ?? [schema]).some((one) => one?.type === "object" && one.additionalProperties !== undefined && one.additionalProperties !== false);
	for (const [key, raw] of flags) {
		const keys = key.split(".");
		const home = objects.find(([param]) => schemaAt(param.schema, keys.slice(0, 1))) ?? objects.find(([param]) => open(param.schema));
		if (!home) throw new DecksError(`decks ${verb.command.join(" ")} has no flag --${key}.\n\n${help(verb)}`);
		const [param, index] = home;
		args[index] ??= {};
		let target = args[index];
		for (const part of keys.slice(0, -1)) target = target[part] ??= {};
		target[keys[keys.length - 1]] = valueOf(raw, schemaAt(param.schema, keys));
	}

	// Words fill the parameters flags did not, in order; a list of paths takes every word left.
	let next = 0;
	for (const [index, param] of verb.params.entries()) {
		if (next >= positional.length) break;
		if (args[index] !== undefined) continue;
		if (param.variadic) {
			const rest = positional.slice(next);
			// One word may be the list itself, as JSON: '["cards/a/index.html","cards/b/index.html"]'.
			args[index] = rest.length === 1 ? valueOf(rest[0], param.schema) : rest;
			next = positional.length;
			break;
		}
		args[index] = valueOf(positional[next++], param.schema);
	}
	if (next < positional.length) throw new DecksError(`decks ${verb.command.join(" ")} takes ${verb.params.length} argument${verb.params.length === 1 ? "" : "s"}; "${positional.slice(next).join(" ")}" is left over.\n\n${help(verb)}`);
	while (args.length && args[args.length - 1] === undefined) args.pop();
	return args;
}

async function main(argv) {
	const words = argv.filter((word) => word !== "--help" && word !== "-h");
	const asksHelp = words.length !== argv.length;
	if (words.length === 0 || (words[0] === "help" && words.length === 1)) {
		out(help());
		return 0;
	}
	if (words[0] === "help") {
		const found = verbOf(words.slice(1));
		out(found ? help(found.verb) : help());
		return found ? 0 : 1;
	}
	if (words[0] === "server") return server(words.slice(1));
	// Decks as an MCP server on stdin and stdout, for a client that starts it: claude mcp add decks -- decks mcp
	if (words[0] === "mcp") {
		const { serve } = await import("../mcp/server.mjs");
		await serve();
		return 0;
	}
	// `decks login https://host`: that harness, for this command and for the token it keeps.
	if (words[0] === "login") {
		const url = words.slice(1).find((word) => /^https?:\/\//.test(word));
		if (url) process.env.DECKS_URL = url.replace(/\/+$/, "");
	}
	// A terminal the environment told nothing: find this user's Decks, and start it when there is none.
	if (!process.env.DECKS_URL && process.env.DECKS_AUTOSTART !== "0") {
		const ready = await ensureServer();
		if (ready.started) err(`decks: no Decks was running, so ${ready.how}.`);
	}
	if (words[0] === "login") {
		err(await login(words.slice(1)));
		return 0;
	}
	if (words[0] === "password") {
		err(await password(words.slice(1)));
		return 0;
	}
	if (words[0] === "logout") {
		err(await logout());
		return 0;
	}
	// Not a verb: every change as it is broadcast, one JSON line each, until stopped.
	if (words[0] === "events") {
		const decks = connect(caller());
		const stream = decks.events((event) => out(JSON.stringify(event)), { types: words.slice(1) });
		await stream.done;
		return 0;
	}
	const found = verbOf(words);
	if (!found) {
		err(`decks: no command "${words.slice(0, 2).join(" ")}". decks --help lists them.`);
		return 1;
	}
	if (asksHelp) {
		out(help(found.verb));
		return 0;
	}
	const args = argsOf(found.verb, found.rest);
	const decks = connect(caller());
	const { value, notes } = await decks.call(found.verb.name, args);
	// Signing in to Studio is finished here, as Claude Code's is: the address, then the code its page shows, pasted.
	if (found.verb.name === "studio.login" && value?.url && process.stdin.isTTY) return studioCode(decks, value.url);
	if (value !== undefined && value !== null) out(typeof value === "string" ? value : JSON.stringify(value, null, 2));
	for (const note of notes) err(note);
	return 0;
}

/**
 * `decks studio login`, with someone at the terminal: the address to open in a browser, on this
 * machine or any other, then a wait for the code Studio's page shows there. Enter with nothing leaves
 * the sign-in open for `decks studio code <code>`.
 */
async function studioCode(decks, url) {
	err("Open this address in a browser, on any device, and sign in to Decks Studio:\n");
	out(url);
	const ask = createInterface({ input: process.stdin, output: process.stderr });
	const code = (await ask.question("\nPaste the code it shows: ")).trim();
	ask.close();
	if (!code) {
		err("Nothing pasted. The sign-in waits ten minutes: decks studio code <code> finishes it.");
		return 1;
	}
	const done = await decks.call("studio.code", [code]);
	for (const note of done.notes) err(note);
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(error) => {
		if (error instanceof DecksError) {
			err(`decks: ${error.message}`);
			for (const note of error.notes ?? []) err(note);
		} else err(`decks: ${error?.stack ?? error}`);
		process.exit(1);
	},
);
