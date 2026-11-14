import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { clientFor, DecksError } from "../../clients/sdk/index.ts";

// One call made three ways, a script, the decks command and the MCP relay,
// each answering { value } or { refusal } in the same form, so a test can
// say all three are equal.

export type Same = { value: unknown } | { refusal: { code: string; message: string; hint?: string } };

const CLI = fileURLToPath(new URL("../../clients/cli/main.ts", import.meta.url));
const MCP = fileURLToPath(new URL("../../clients/mcp/main.ts", import.meta.url));

export async function byScript(url: string, token: string, name: string, args: Record<string, unknown>): Promise<Same> {
	try {
		return { value: (await clientFor(url, token).call(name, args)).value };
	} catch (error) {
		const e = error as DecksError;
		return { refusal: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) } };
	}
}

/** decks <noun> <verb> --args '<json>': stdout parsed, or the refusal read off stderr. */
export function byCommand(url: string, token: string, name: string, args: Record<string, unknown>): Promise<Same> {
	const [noun, verb] = name.split(".");
	return new Promise((resolve) => {
		execFile(process.execPath, [CLI, noun!, verb!, "--args", JSON.stringify(args)], { env: { ...process.env, DECKS_URL: url, DECKS_TOKEN: token } }, (error, stdout, stderr) => {
			if (!error) return resolve({ value: parse(stdout.trim()) });
			const said = /^decks: (.*) \((\w+)\)(?:\n {2}try: decks (\w+) (\w+))?/.exec(stderr);
			resolve({ refusal: { code: said?.[2] ?? "?", message: said?.[1] ?? stderr, ...(said?.[3] ? { hint: `${said[3]}.${said[4]}` } : {}) } });
		});
	});
}

/** One tools/call through the relay over stdio. */
export function byMcp(url: string, token: string, name: string, args: Record<string, unknown>): Promise<Same> {
	const child = spawn(process.execPath, [MCP], { env: { ...process.env, DECKS_URL: url, DECKS_TOKEN: token } });
	return new Promise((resolve) => {
		let out = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			out += chunk;
			const line = out.split("\n").find((one) => one.includes('"id":2'));
			if (!line) return;
			child.kill();
			const result = (JSON.parse(line) as { result: { isError: boolean; content: { text: string }[] } }).result;
			const lines = result.content[0]!.text.split("\n");
			if (!result.isError) return resolve({ value: parse(lines.slice(0, valueLines(lines)).join("\n")) });
			const said = /^(.*) \((\w+)\)$/.exec(lines[0]!);
			const hint = /^Try (.+)\.$/.exec(lines[1] ?? "")?.[1];
			resolve({ refusal: { code: said?.[2] ?? "?", message: said?.[1] ?? lines[0]!, ...(hint ? { hint } : {}) } });
		});
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } })}\n`);
	});
}

function parse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** The value is the text up to the notes: the JSON that parses, the longest first. */
function valueLines(lines: string[]): number {
	for (let n = lines.length; n > 0; n--) {
		try {
			JSON.parse(lines.slice(0, n).join("\n"));
			return n;
		} catch {
			continue;
		}
	}
	return 1;
}
