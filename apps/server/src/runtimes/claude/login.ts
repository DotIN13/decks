/**
 * Signing in to Claude, for the whole harness: what the sign-in modal drives (`web/src/settings/ClaudeLogin.tsx`).
 *
 * It used to run inside a Claude agent (`/login`, the agent's dock dialogs): Add account in Settings
 * sent `/login` to whichever Claude agent was running, so with none it could not sign in at all, and
 * its questions appeared above that agent's composer rather than where the person had asked. Now the
 * harness runs it, one at a time, and the page shows it in a modal of its own.
 *
 * The flow is the CLI's own `claude auth login`, which is a paste-the-code flow: it prints an OAuth
 * link, then waits on stdin for the code the browser shows at the end.
 *
 * 1. `start(method)`: which account (a subscription, or an API account on the Console; the flag is
 *    chosen before the process starts), into a fresh account directory (`accounts.ts`, `begin`), so
 *    this adds an account rather than replacing one. Answers the link.
 * 2. `finish(code)`: the code written to the CLI's stdin; its exit code is the answer. On success the
 *    account is remembered under the identity the CLI reports, and `signedIn` is called, which
 *    publishes the list and has every Claude agent read its models again.
 * 3. `cancel()`: the CLI stopped, the half-made directory left for the next sweep.
 *
 * A poll stays as a fallback in case a flow ever completes in the browser alone: the directory is
 * new and empty, so credentials appearing there can only be this sign-in's (`done` then says so).
 *
 * Decks stores no tokens: the credentials are Claude's own, written by Claude's code into the
 * account's directory.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { accountEnvironment } from "./accounts.ts";
import { claudeBundledExecutable, claudeExecutable } from "./available.ts";
import { claudeAuthStatus, claudeIdentity } from "./auth-command.ts";
import { firstUrl, lastLine, plain } from "./cli-output.ts";

export type LoginMethod = "subscription" | "api";

const FLAGS: Record<LoginMethod, string> = { subscription: "--claudeai", api: "--console" };

/** What signing in needs of the account list (`ClaudeAccounts`). */
export interface LoginAccounts {
	begin(): { id: string; configDir: string };
	remember(account: { id: string; email?: string; orgName?: string; plan?: string; kind: "subscription" | "api" }): { email?: string; replaced?: true };
}

/** What happened, for the page: a flow that finished by itself (the poll), or failed after the link. */
export type LoginEvent = { phase: "done"; email?: string } | { phase: "failed"; message: string };

type Flow = { child: ChildProcess; method: LoginMethod; into: { id: string; configDir: string }; exited: Promise<number | null>; said: () => string; poll?: NodeJS.Timeout };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ClaudeLogin {
	private flow: Flow | undefined;

	constructor(
		private readonly accounts: LoginAccounts,
		/** A sign-in landed: publish the accounts, and have every Claude agent read its models again. */
		private readonly signedIn: () => void,
		/** Tell the page what happened when it did not ask (`account.login`). */
		private readonly tell: (event: LoginEvent) => void,
	) {}

	/** Start a sign-in, and answer the link to open. Any sign-in already under way is stopped first. */
	async start(method: LoginMethod): Promise<{ url: string }> {
		this.cancel();
		const binary = claudeExecutable() ?? claudeBundledExecutable();
		if (!binary) throw new Error("Claude Code is not installed on this machine, so there is nothing to sign in with.");
		const into = this.accounts.begin();
		const child = spawn(binary, ["auth", "login", FLAGS[method]], { stdio: ["pipe", "pipe", "pipe"], env: accountEnvironment(into.configDir, into.configDir) });

		let url: string | undefined;
		let found: () => void = () => {};
		const urlReady = new Promise<void>((resolve) => (found = resolve));
		let stderr = "";
		let lastSaid = "";
		child.stdout?.on("data", (data: Buffer) => {
			for (const raw of plain(data.toString()).split(/\r?\n/)) {
				const link = firstUrl(raw);
				if (link) {
					url ??= link;
					found();
					continue;
				}
				const line = raw.trim();
				if (line && !/paste code/i.test(line)) lastSaid = line;
			}
		});
		child.stderr?.on("data", (data: Buffer) => (stderr += data.toString()));
		const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
		const said = () => lastLine(stderr) || lastSaid;

		await Promise.race([urlReady, exited, sleep(20_000)]);
		if (!url) {
			child.kill();
			throw new Error(said() || "Claude's sign-in would not start.");
		}
		const flow: Flow = { child, method, into, exited, said };
		this.flow = flow;
		flow.poll = setInterval(() => {
			void claudeAuthStatus(into.configDir).then(async (auth) => {
				if (!auth.loggedIn || this.flow !== flow) return;
				this.tell({ phase: "done", ...(await this.land(flow)) });
			});
		}, 2500);
		return { url };
	}

	/** Finish the sign-in with the code the browser gave. Throws Claude's own sentence when it refuses. */
	async finish(code: string): Promise<{ email?: string; replaced?: true }> {
		const flow = this.flow;
		if (!flow) throw new Error("No sign-in is under way. Start again.");
		const trimmed = String(code ?? "").trim();
		if (!trimmed) throw new Error("Paste the code the browser showed at the end of the sign-in.");
		if (flow.poll) clearInterval(flow.poll);
		flow.child.stdin?.write(`${trimmed}\n`);
		const exitCode = await Promise.race([flow.exited, sleep(60_000).then(() => "timeout" as const)]);
		if (this.flow !== flow) throw new Error("This sign-in was stopped. Start again.");
		if (exitCode === "timeout") {
			this.stop(flow);
			throw new Error("Claude's sign-in did not finish. Start again.");
		}
		if (exitCode !== 0) {
			this.stop(flow);
			throw new Error(flow.said() || "Claude's sign-in failed.");
		}
		return this.land(flow);
	}

	/** Stop a sign-in under way, if any. */
	cancel(): void {
		if (this.flow) this.stop(this.flow);
	}

	/** Who was just signed in, read back out of the CLI, remembered on the list. */
	private async land(flow: Flow): Promise<{ email?: string; replaced?: true }> {
		if (flow.poll) clearInterval(flow.poll);
		this.flow = undefined;
		const identity = await claudeIdentity(flow.into.configDir);
		const remembered = this.accounts.remember({ id: flow.into.id, ...identity, kind: flow.method === "api" ? "api" : "subscription" });
		this.signedIn();
		return { ...(remembered.email ? { email: remembered.email } : {}), ...(remembered.replaced ? { replaced: true as const } : {}) };
	}

	private stop(flow: Flow): void {
		if (flow.poll) clearInterval(flow.poll);
		flow.child.kill();
		if (this.flow === flow) this.flow = undefined;
	}
}
