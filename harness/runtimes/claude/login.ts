// The Claude CLI run outside a session: whether a config folder is signed in
// and as whom, and reading what the CLI prints for a terminal, for /login.
import { spawn } from "node:child_process";
import { accountEnvironment } from "../../accounts/index.ts";
import { claudeBundledExecutable, claudeExecutable } from "./available.ts";

// --- the CLI outside a session ----------------------------------------------------

/** The CLI's own auth subcommand, to be run outside any session. */
export function runClaudeCommand(
	args: string[],
	timeoutMs = 30_000,
	/** Which account to ask about; omitted means the CLI's own `~/.claude`. */
	configDir?: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const binary = claudeExecutable() ?? claudeBundledExecutable();
		if (!binary) {
			resolve({ code: 1, stdout: "", stderr: "No Claude Code executable found." });
			return;
		}
		const child = spawn(binary, args, {
			stdio: ["ignore", "pipe", "pipe"],
			// The account's own directory is both where it reads from and what names its
			// keychain entry, which is what makes `auth status` agree with the session.
			...(configDir ? { env: accountEnvironment(configDir, configDir) } : {}),
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
		child.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
		const timer = setTimeout(() => child.kill(), timeoutMs);
		child.on("exit", (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
	});
}

/** Whether the CLI's own credentials file says signed in, and how. */
export async function claudeAuthStatus(configDir?: string): Promise<{ loggedIn: boolean; label: string }> {
	try {
		const { stdout } = await runClaudeCommand(["auth", "status"], 30_000, configDir);
		const data = JSON.parse(stdout) as { loggedIn?: boolean; authMethod?: string; apiProvider?: string };
		return {
			loggedIn: data.loggedIn === true,
			label: [data.authMethod, data.apiProvider].filter(Boolean).join(" · "),
		};
	} catch {
		return { loggedIn: false, label: "" };
	}
}

/**
 * Who a config directory is signed in as, from the CLI's own `auth status`.
 *
 * Read rather than remembered: somebody who runs `claude auth login` in a terminal has
 * changed it without Decks hearing about it. The sign-in and the usage report ask it.
 */
export async function claudeIdentity(configDir?: string): Promise<{ email?: string; orgName?: string; plan?: string; signedOut?: true }> {
	try {
		const { stdout } = await runClaudeCommand(["auth", "status"], 30_000, configDir);
		const data = JSON.parse(stdout) as { loggedIn?: boolean; email?: string; orgName?: string; subscriptionType?: string };
		// Said by the CLI, which is the one answer that means the account cannot be used. A
		// command that failed or timed out says nothing either way, and answers `{}`.
		if (data.loggedIn !== true) return { signedOut: true };
		return {
			...(data.email ? { email: data.email } : {}),
			...(data.orgName ? { orgName: data.orgName } : {}),
			...(data.subscriptionType ? { plan: data.subscriptionType } : {}),
		};
	} catch {
		return {};
	}
}

/**
 * A terminal line as its text, with the escape sequences taken out.
 *
 * Reading what the Claude CLI prints, when there is no terminal to print it to.
 *
 * `/login` runs the CLI's own `auth login` as a child process and has to find the OAuth
 * URL in its output. That output is written for a terminal, which is a different thing
 * from being written for a program: the URL arrives inside an **OSC-8 hyperlink**, where
 * the address appears twice — once in the escape sequence, once as the visible text —
 * separated by a BEL that no `\S` pattern stops at:
 *
 *     If the browser didn't open, visit: ESC]8;;<url>BEL<url>ESC]8;;BEL
 *
 * So a regex over the raw line matches both copies and the escape between them, and hands
 * back an address nothing can open. Strip first, then match.
 */
export function plain(text: string): string {
	return (
		text
			// OSC: ESC ] … terminated by BEL or ST. Non-greedy, so two on one line stay two.
			.replace(/\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g, "")
			// CSI: colours, cursor moves, the rest of what a TUI paints with.
			.replace(/\u001B\[[0-9;?]*[ -\/]*[@-~]/g, "")
	);
}

/** The first URL in a chunk of terminal output, or nothing if it has none yet. */
export function firstUrl(text: string): string | undefined {
	return /https?:\/\/\S+/.exec(plain(text))?.[0];
}

/** The last thing a CLI run said, for a notice a person can act on. */
export function lastLine(output: string): string | undefined {
	const line = plain(output).trim().split(/\r?\n/).at(-1)?.trim();
	return line || undefined;
}
