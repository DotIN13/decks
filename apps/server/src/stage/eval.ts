import { transform } from "esbuild";

/**
 * Run the agent's TypeScript against the stage.
 *
 * This is the one tool the agent has for the canvas, so the shape matters: the code
 * is the body of an async function with `stage` and `console` in scope, whatever it
 * returns comes back as JSON, and whatever it logs comes back with it. That is
 * enough to be a REPL against the environment, which beats a table of narrow tools
 * that each need their own name.
 *
 * It is **not a sandbox**, deliberately. The same agent already has `bash`; a
 * sandbox here would buy nothing it does not already have, and pretending otherwise
 * would be worse than saying so. What gates it is whatever gates `bash` — a Pi
 * permission extension (DESIGN §6.8).
 *
 * The timeout stops *waiting*, not the code: JavaScript in-process cannot be killed.
 * A runaway eval keeps running in the background and the agent is told the wait
 * ended, which is the honest report.
 */

export interface EvalOutcome {
	value: unknown;
	logs: string[];
	error?: string;
	timedOut?: boolean;
}

const TIMEOUT_MS = 20_000;

export async function runEval(code: string, stage: unknown, timeoutMs = TIMEOUT_MS): Promise<EvalOutcome> {
	const logs: string[] = [];
	const record = (level: string) => (...args: unknown[]) => {
		const text = args.map((arg) => (typeof arg === "string" ? arg : safeJson(arg))).join(" ");
		logs.push(level === "log" ? text : `[${level}] ${text}`);
	};
	const console = { log: record("log"), warn: record("warn"), error: record("error"), info: record("log"), debug: record("log") };

	/*
	 * Wrapped into a function *before* compiling, not after.
	 *
	 * The API tells the agent to `return` a value, and a top-level return is a syntax
	 * error in a module — so compiling the snippet on its own rejected exactly the
	 * code the documentation asks for. Wrapping first makes the return statement what
	 * it looks like: a return from the function the agent is writing the body of.
	 *
	 * `format` is left alone so esbuild strips types and nothing else: no module
	 * wrapper, no import resolution. The agent's code is a snippet against one
	 * object, and its mistakes should read as its mistakes.
	 */
	let javascript: string;
	try {
		const result = await transform(`async function __decksRun(stage, console) {\n${code}\n}`, {
			loader: "ts",
			target: "es2022",
		});
		javascript = result.code;
	} catch (error) {
		return { value: undefined, logs, error: `Could not compile: ${(error as Error).message}` };
	}

	let run: () => Promise<unknown>;
	try {
		const factory = new Function(`${javascript}\nreturn __decksRun;`)() as (
			stage: unknown,
			console: unknown,
		) => Promise<unknown>;
		run = () => factory(stage, console);
	} catch (error) {
		return { value: undefined, logs, error: `Could not build: ${(error as Error).message}` };
	}

	let timer: NodeJS.Timeout | undefined;
	try {
		const value = await Promise.race([
			run(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new EvalTimeout(timeoutMs)), timeoutMs);
			}),
		]);
		return { value, logs };
	} catch (error) {
		if (error instanceof EvalTimeout) return { value: undefined, logs, error: error.message, timedOut: true };
		return { value: undefined, logs, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
	} finally {
		if (timer) clearTimeout(timer);
	}
}

class EvalTimeout extends Error {
	constructor(ms: number) {
		super(`Still running after ${ms / 1000}s — the wait was abandoned, but the code was not stopped (it cannot be).`);
		this.name = "EvalTimeout";
	}
}

/** A value the agent will read: readable, and never a crash on a cycle. */
export function safeJson(value: unknown): string {
	const seen = new WeakSet<object>();
	try {
		return JSON.stringify(
			value,
			(_key, item) => {
				if (typeof item === "object" && item !== null) {
					if (seen.has(item)) return "[circular]";
					seen.add(item);
				}
				if (typeof item === "function") return `[function ${item.name || "anonymous"}]`;
				if (typeof item === "bigint") return item.toString();
				return item;
			},
			2,
		) ?? String(value);
	} catch (error) {
		return `[unserialisable: ${(error as Error).message}]`;
	}
}
