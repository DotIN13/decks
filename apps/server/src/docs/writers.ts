import { realpathSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { fileNamed, type ToolEvent } from "../agents/acts.ts";

/**
 * Which agent just wrote a file, read off the tool calls the server already relays.
 *
 * A document's watcher sees bytes change and nothing else, so on its own every outside write is
 * "outside". But each agent's tool calls pass through the server on their way to the browser
 * (`agents/acts.ts` draws cursors from the same stream): a write or edit tool names its file,
 * and a shell command that rewrites a `.docx` names it in its text. A file written while such a
 * call was running, or just after it ended, is credited to that agent; the newest call wins
 * when two match.
 */

/** A call that ended this recently still explains a write the watcher reads now. */
const AFTER_MS = 3000;
/** A call running longer than this explains nothing any more. */
const RUNNING_MS = 10 * 60 * 1000;
const KEPT = 64;

interface Call {
	agentId: string;
	callId: string;
	/** The file a write or edit tool named, resolved. */
	file?: string;
	/** A shell command's text, to look for a file's name in. */
	command?: string;
	start: number;
	end?: number;
}

export interface WritersHost {
	/** The agent's name, or undefined for one that is gone. */
	name(agentId: string): string | undefined;
	/** Where a relative path in a tool call is read from: the agent's working directory. */
	cwd(agentId: string): string;
	now?(): number;
}

export class Writers {
	private readonly calls: Call[] = [];

	constructor(private readonly host: WritersHost) {}

	/** One tool call starting or ending. */
	tool(agentId: string, event: ToolEvent): void {
		const now = this.now();
		if (event.phase === "end") {
			const call = this.calls.find((c) => c.agentId === agentId && c.callId === event.callId);
			if (call) call.end = now;
			return;
		}
		const named = fileNamed(event.name, event.args);
		const command = commandOf(event.name, event.args);
		if (!named && !command) return;
		const file = named ? real(isAbsolute(named) ? named : resolve(this.host.cwd(agentId), named)) : undefined;
		this.calls.push({ agentId, callId: event.callId, ...(file ? { file } : {}), ...(command ? { command } : {}), start: now });
		if (this.calls.length > KEPT) this.calls.splice(0, this.calls.length - KEPT);
	}

	/** The name of the agent most likely to have just written `file`, if any call explains it. */
	who(file: string): string | undefined {
		const now = this.now();
		const name = basename(file);
		for (let i = this.calls.length - 1; i >= 0; i--) {
			const call = this.calls[i]!;
			const live = call.end === undefined ? now - call.start < RUNNING_MS : now - call.end < AFTER_MS;
			if (!live) continue;
			if (call.file === file || (call.command !== undefined && call.command.includes(name))) {
				const who = this.host.name(call.agentId);
				if (who) return who;
			}
		}
		return undefined;
	}

	private now(): number {
		return this.host.now?.() ?? Date.now();
	}
}

/** The real path when the file is there (a document's own path is real), the path as given when not yet. */
function real(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/** A shell tool's command text: Claude's `Bash`, pi's `bash`, and the others' close cousins. */
function commandOf(name: string, args: unknown): string | undefined {
	if (!/^(bash|shell|sh|exec|execute|run|run_command|run_shell_command|terminal)$/i.test(name)) return undefined;
	if (!args || typeof args !== "object") return undefined;
	const record = args as Record<string, unknown>;
	for (const key of ["command", "cmd", "script", "code", "commandLine"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value;
		if (Array.isArray(value)) return value.join(" ");
	}
	return undefined;
}
