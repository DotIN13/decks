import { spawn } from "node:child_process";
import { claudeBundledExecutable, claudeExecutable } from "./available.ts";
import { accountEnvironment } from "./accounts.ts";

/**
 * The CLI's own `auth` subcommands, run outside any session: who an account is signed in as,
 * and signing out. Used by the backend's `/status` and `/logout`, the account list and the
 * sign-in flow, which is why they are not the backend's own.
 */

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
 * Exported because the account list needs it for every row, including the CLI's own — and
 * that is the one that must be read rather than remembered: somebody who runs
 * `claude auth login` in a terminal has changed it without Decks hearing about it.
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
