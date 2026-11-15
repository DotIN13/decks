import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { CALL_BY_NAME } from "../../protocol/index.ts";
import { connect, DecksError, find, tokensFile } from "../sdk/index.ts";
import { argsOf, Usage } from "./args.ts";
import { help } from "./help.ts";
import { login, logout } from "./login.ts";

export { login };

// The decks command: decks <noun> <verb> for every call, and help, events,
// login, logout, serve, attach and detach. The value goes to stdout, a
// string as it is and anything else as JSON; notes and refusals to stderr.

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
			const call = callOf(words.slice(1)) ?? CALL_BY_NAME.get(words[1] ?? "");
			io.out(call ? help(call) : help());
			return call ? 0 : 1;
		}
		const handled = await special(words, io);
		if (handled !== undefined) return handled;
		const call = callOf(words);
		if (!call) return io.err(`decks: no command "${words.slice(0, 2).join(" ")}". decks help lists them.`), 1;
		if (words.length !== argv.length) return io.out(help(call)), 0;
		const args = argsOf(call, words.slice(call.name === words[0] ? 1 : 2), io.stdin);
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

async function special(words: string[], io: Io): Promise<number | undefined> {
	const [first, ...rest] = words;
	if (first === "login") return io.err(await login(rest, await tokensFile())), 0;
	if (first === "logout") return io.err(logout((await find({})).url, await tokensFile())), 0;
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
