import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { CALL_BY_NAME } from "../../protocol/index.ts";
import { OLD_CALLS } from "../../protocol/compat/old-calls.ts";
import { connect, DecksError, find, tokensFile } from "../sdk/index.ts";
import { argsOf, oldArgsOf, Usage } from "./args.ts";
import { help } from "./help.ts";
import { login, logout } from "./login.ts";

// The decks command: decks <noun> <verb> for every call, and help, events,
// login, logout, serve, attach and detach. Today's words answer too, through
// protocol/compat. The value goes to stdout, a string as it is and anything
// else as JSON; notes and refusals to stderr.

export { login };

export type Io = { out(text: string): void; err(text: string): void; stdin(): string };

const nodeIo: Io = {
	out: (text) => process.stdout.write(text.endsWith("\n") ? text : `${text}\n`),
	err: (text) => process.stderr.write(text.endsWith("\n") ? text : `${text}\n`),
	stdin: () => readFileSync(0, "utf8"),
};

export async function run(argv: string[], io: Io = nodeIo): Promise<number> {
	const words = argv.filter((word) => word !== "--help" && word !== "-h");
	try {
		if (words.length === 0 || (words[0] === "help" && words.length === 1)) return io.out(help()), 0;
		if (words[0] === "help") {
			const old = oldOf(words.slice(1));
			const call = callOf(words.slice(1)) ?? CALL_BY_NAME.get(words[1] ?? "") ?? (old && CALL_BY_NAME.get(old.row[2]));
			io.out(call ? help(call) : help());
			return call ? 0 : 1;
		}
		const handled = await special(words, io);
		if (handled !== undefined) return handled;
		const call = callOf(words);
		const old = oldOf(words);
		if (old && (!call || readsOld(call.name, old, words))) return await runOld(old, words, argv, io);
		if (!call) return io.err(`decks: no command "${words.slice(0, 2).join(" ")}". decks help lists them.`), 1;
		if (words.length !== argv.length) return io.out(help(call)), 0;
		let args: Record<string, unknown>;
		try {
			args = argsOf(call, words.slice(call.name === words[0] ? 1 : 2), io.stdin);
		} catch (error) {
			// Today's flags on a name both share (decks agent update --name): read as today's.
			if (error instanceof Usage && old) return await runOld(old, words, argv, io);
			throw error;
		}
		const { value, notes } = await (await connect()).call(call.name, args);
		if (value !== undefined && value !== null) io.out(typeof value === "string" ? value : JSON.stringify(value, null, 2));
		for (const note of notes) io.err(note);
		return 0;
	} catch (error) {
		if (error instanceof DecksError) {
			io.err(`decks: ${error.message} (${error.code})${error.hint ? `\n  try: decks ${error.hint.replace(".", " ")}` : ""}`);
			for (const note of error.notes) io.err(note);
		} else if (error instanceof Usage) io.err(`decks: ${error.message}`);
		else io.err(`decks: ${(error as Error)?.message ?? String(error)}`);
		return 1;
	}
}

/** The call a command line names: decks item move ... is item.move. */
const callOf = (words: string[]) => CALL_BY_NAME.get(`${words[0]}.${words[1]}`) ?? CALL_BY_NAME.get(words[0] ?? "");

// Today's words.
type Old = { row: (typeof OLD_CALLS)[number]; used: number };
const OLD_BY_NAME = new Map(OLD_CALLS.map((row) => [row[0], row]));
const camel = (word = "") => word.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** Today's call a command line names, decks canvas insert or decks here, with how many words name it. */
function oldOf(words: string[]): Old | undefined {
	const two = OLD_BY_NAME.get(`${words[0]}.${camel(words[1])}`);
	if (two) return { row: two, used: 2 };
	const one = OLD_BY_NAME.get(words[0] ?? "");
	return one ? { row: one, used: 1 } : undefined;
}

/** A name in both, meaning other things (canvas delete, copy, update): a plain word after it is today's item. */
function readsOld(name: string, old: Old, words: string[]): boolean {
	return old.row[0] === name && old.row[2] !== name && words.slice(old.used).some((word) => !word.startsWith("--"));
}

/** Today's command, answered by its new call and given today's answer; a note says the new words. */
async function runOld(old: Old, words: string[], argv: string[], io: Io): Promise<number> {
	const now = CALL_BY_NAME.get(old.row[2]);
	if (words.length !== argv.length) return io.out(now ? help(now) : help()), 0;
	const args = oldArgsOf(old.row[3], now, words.slice(old.used), io.stdin);
	const { value, notes } = await (await connect()).call(old.row[0], args);
	if (value !== undefined && value !== null) io.out(typeof value === "string" ? value : JSON.stringify(value, null, 2));
	io.err(`decks: "${words.slice(0, old.used).join(" ")}" is "decks ${old.row[2].replace(".", " ")}" now.`);
	for (const note of notes) io.err(note);
	return 0;
}

async function special(words: string[], io: Io): Promise<number | undefined> {
	const [first, ...rest] = words;
	if (first === "login") return io.err(await login(rest, await tokensFile())), 0;
	if (first === "logout") return io.err(await logout((await find({})).url, await tokensFile())), 0;
	if (first === "attach" || first === "detach") {
		const attach = await import("../attach/index.ts");
		io.err(await (first === "attach" ? attach.attach(rest) : attach.detach(rest)));
		return 0;
	}
	if (first === "serve") return serve(rest);
	if (first === "events") {
		const client = await connect();
		const stream = client.events((event) => io.out(JSON.stringify(event)), rest.length ? { events: rest } : {});
		await stream.done;
		return 0;
	}
	return undefined;
}

/** decks serve: Decks-local in the foreground, on a deck folder; tsx loads the old packages it still uses. */
function serve(words: string[]): Promise<number> {
	const main = new URL("../../server/main.ts", import.meta.url);
	const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), main.pathname, ...words], { stdio: "inherit" });
	return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
}
