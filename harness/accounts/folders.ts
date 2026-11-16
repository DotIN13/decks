// Where each Claude account's files live, and what every account shares with the
// CLI's own login: the folders linked in, and the keychain entry its token is under.
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";

/** The two keychain calls a sign-in that replaces another needs. */
export interface Keychain {
	read(service: string): string | undefined;
	write(service: string, value: string): void;
}

/**
 * Where the CLI's own login keeps its things, and which platform it keeps them for.
 *
 * Two paths rather than one because the CLI keeps them in two places. The config home is
 * `CLAUDE_CONFIG_DIR ?? ~/.claude`, but `.claude.json` is resolved as
 * `join(CLAUDE_CONFIG_DIR ?? homedir(), ".claude.json")` — *beside* the config home rather
 * than inside it, when the variable is unset. Which is the whole reason `default` needs a
 * directory of links instead of a link straight at `~/.claude`: pointing `CLAUDE_CONFIG_DIR`
 * at `~/.claude` would move `.claude.json` to `~/.claude/.claude.json` and leave the CLI's
 * own identity, project trust and MCP config behind.
 */
export interface ClaudeHome {
	configDir: string;
	configFile: string;
	/** macOS keeps tokens in the keychain rather than in a file — see `hasCredentials`. */
	platform: NodeJS.Platform;
	/** The macOS keychain, as the CLI uses it; injected so a test never touches the real one. */
	keychain?: Keychain;
}

/** The row for the CLI's own `~/.claude`, which has no directory of its own. */
export const DEFAULT_ACCOUNT = "default";

/** An account's folders; ClaudeAccounts keeps the list, the links and the readings on them. */
export abstract class AccountFolders {
	// --- where things live
	/**
	 * `home` is where the CLI's own login keeps its things — passed in rather than looked up
	 * inside the class, because the `default` account is a *view of that directory* and a
	 * test that reached into the real `~/.claude` of whoever ran it would pass or fail by
	 * accident.
	 */
	constructor(
		protected dataDir: string,
		protected readonly home: ClaudeHome = claudeHome(),
	) {}
	setDataDir(dataDir: string): void {
		this.dataDir = dataDir;
	}
	protected get dir(): string {
		return join(this.dataDir, "claude-accounts");
	}
	protected get file(): string {
		return join(this.dir, "index.json");
	}
	/** Where one account's own credentials live. */
	configDir(id: string): string {
		return join(this.dir, id);
	}
	protected get link(): string {
		return join(this.dir, "active");
	}

	// --- what every account shares with the CLI's own login
	/**
	 * `claude-accounts/default/`: the CLI's own config home, seen through symlinks.
	 *
	 * The obvious thing would be to point `active` straight at `~/.claude`, and it is wrong
	 * for one reason: `.claude.json` — which holds `oauthAccount`, project trust and MCP
	 * config — is resolved as `join(CLAUDE_CONFIG_DIR ?? homedir(), ".claude.json")`. Setting
	 * the variable at all moves it *inside* the config home, so the CLI's own login would
	 * come up with no identity, no trust and no MCP servers. A directory of links gets the
	 * variable set and every file resolved back to where the CLI actually keeps it.
	 *
	 * Safe because **the CLI writes through symlinks rather than replacing them** — verified
	 * by running it against a config directory of links and watching the targets grow. So a
	 * refreshed token lands in `~/.claude/.credentials.json`, which is the same property that
	 * makes the `active` link itself work.
	 *
	 * Every entry is linked rather than a chosen few, so nothing is silently left behind when
	 * the CLI grows a new file. Re-run on open and on every session start, which is what
	 * picks up entries that appeared since.
	 */
	protected mirrorDefault(): void {
		const into = this.configDir(DEFAULT_ACCOUNT);
		let entries: string[];
		try {
			mkdirSync(this.home.configDir, { recursive: true });
			entries = readdirSync(this.home.configDir);
		} catch {
			return;
		}
		this.mirror(into, this.home.configDir, entries);
		// The one file that is not in the config home at all.
		this.linkOne(join(into, ".claude.json"), this.home.configFile);
	}
	/**
	 * The parts of a config directory that are *not* about which subscription is signed in.
	 *
	 * Transcripts and memory (`projects/`), what the person has allowed (`settings.json`),
	 * and what they have written for themselves (`commands/`, `agents/`, `skills/`). None of
	 * it belongs to an account, and all of it used to move when one became active — so an
	 * agent switched accounts and lost its memory, its permissions and every transcript it
	 * could rewind to.
	 *
	 * Deliberately not shared: `.credentials.json` and `.claude.json`, which *are* the
	 * account; and `policy-limits.json`, `remote-settings.json`, `statsig/`, `sessions/` and
	 * `backups/`, which are per-subscription state fetched from the server.
	 */
	protected static readonly SHARED = [
		"projects",
		"todos",
		"file-history",
		"shell-snapshots",
		"plugins",
		"commands",
		"agents",
		"skills",
		"settings.json",
		"settings.local.json",
		"keybindings.json",
		"CLAUDE.md",
	];
	/** Give one account directory its share of what is not account-bound. */
	protected share(configDir: string): void {
		this.mirror(configDir, this.home.configDir, AccountFolders.SHARED);
	}
	/**
	 * Make named entries of `from` reachable through `into` as symlinks.
	 *
	 * Anything already written into `into` directly is *adopted* rather than destroyed: a
	 * real directory has its children moved across one by one, and only ever into a name that
	 * is free, so nothing is overwritten. What cannot be moved without a collision is left
	 * where it is and simply not linked, which is a directory somebody can still find.
	 */
	protected mirror(into: string, from: string, names: string[]): void {
		try {
			mkdirSync(into, { recursive: true });
		} catch {
			return;
		}
		for (const name of names) {
			if (name === "." || name === ".." || name.includes("/")) continue;
			this.linkOne(join(into, name), join(from, name));
		}
	}
	/** One entry: adopt whatever is there, then link it at `target`. */
	protected linkOne(at: string, target: string): void {
		try {
			if (readlinkSync(at) === target) return;
		} catch {
			/* not a link, or nothing there */
		}
		let local: ReturnType<typeof lstatSync> | undefined;
		try {
			local = lstatSync(at);
		} catch {
			/* nothing there, which is the ordinary case */
		}
		if (local && !local.isSymbolicLink()) {
			if (!this.adopt(at, target, join(dirname(at), DISPLACED, basename(at)))) return;
		} else if (local) {
			// A link pointing somewhere else: ours to replace.
			try {
				rmSync(at, { force: true });
			} catch {
				return;
			}
		}
		let exists = true;
		try {
			statSync(target);
		} catch {
			exists = false;
		}
		if (!exists) return;
		try {
			symlinkSync(target, at);
		} catch {
			/* no symlinks here; the account simply keeps its own copy */
		}
	}
	/**
	 * Move what was written locally back to where it should have gone.
	 *
	 * Returns whether `at` is now free to be replaced by a link. Nothing is ever overwritten:
	 * an entry moves only into a name that is free, two directories are merged child by child,
	 * and **a name the shared store already has is won by the shared copy** — the local one is
	 * moved into `<config dir>/displaced/…`, contents and all, rather than left where it is.
	 *
	 * That last clause is the bug this was rewritten for. It used to give up on a collision and
	 * return false, and false travels *up*: one stale duplicate of one transcript inside
	 * `projects/` meant the directory was never emptied, never removed and never linked, and
	 * the account went on reading a private store instead. On this install that cost the
	 * Stanford account 53 transcripts it could not see — a resume of a conversation created
	 * before the account existed answered *No conversation found with session ID*, and the turn
	 * ended as `error_during_execution`. The comment above has always promised "loses nobody a
	 * transcript"; this is the version where that is true.
	 *
	 * Recursive, because the collision is usually one level down. An account signed in before
	 * any of this existed has `projects/<deck>/` and so does the config home: the directories
	 * collide, the transcripts inside them do not.
	 */
	protected adopt(at: string, target: string, aside: string): boolean {
		const kind = (path: string): "none" | "dir" | "other" => {
			try {
				return lstatSync(path).isDirectory() ? "dir" : "other";
			} catch {
				return "none";
			}
		};
		try {
			if (kind(target) === "none") {
				mkdirSync(dirname(target), { recursive: true });
				renameSync(at, target);
				return true;
			}
			/*
			 * A name the shared store already has. The shared copy is the live one — it is what
			 * every other account and every other agent has been reading and writing — so the
			 * local copy is moved aside rather than merged over it or left blocking the link.
			 */
			if (kind(at) !== "dir" || kind(target) !== "dir") {
				mkdirSync(dirname(aside), { recursive: true });
				renameSync(at, freeName(aside));
				return true;
			}
			for (const child of readdirSync(at)) {
				if (!this.adopt(join(at, child), join(target, child), join(aside, child))) return false;
			}
			rmSync(at, { recursive: true, force: true });
			return true;
		} catch {
			return false;
		}
	}
}

// --- the CLI's own login and its keychain
// --- the CLI's own login and its keychain
/** What the CLI's own login is on this machine, read from the environment once. */
export function claudeHome(): ClaudeHome {
	const configured = process.env.CLAUDE_CONFIG_DIR;
	return {
		configDir: configured ?? join(homedir(), ".claude"),
		configFile: join(configured ?? homedir(), ".claude.json"),
		platform: process.platform,
	};
}

/** The fields of `.claude.json` that say who a directory is signed in as. */
export const SIGNED_IN_FIELDS = ["oauthAccount", "primaryApiKey", "customApiKeyResponses"] as const;

/** The account name the CLI files its keychain entries under (its `R0`). */
export function keychainUser(): string {
	let user: string;
	try {
		user = process.env.USER || userInfo().username;
	} catch {
		user = "claude-code-user";
	}
	return /^[a-zA-Z0-9._-]+$/.test(user) ? user : "claude-code-user";
}

/**
 * The real keychain, through `security`. The value is written through `security -i`'s stdin
 * and as hex, so a token is never on a command line where `ps` could read it.
 */
export const systemKeychain: Keychain = {
	read(service) {
		try {
			const out = execFileSync("security", ["find-generic-password", "-a", keychainUser(), "-w", "-s", service], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
			return out.replace(/\n$/, "") || undefined;
		} catch {
			return undefined;
		}
	},
	write(service, value) {
		const hex = Buffer.from(value, "utf8").toString("hex");
		spawnSync("security", ["-i"], { input: `add-generic-password -U -a "${keychainUser()}" -s "${service}" -X ${hex}\n`, stdio: ["pipe", "ignore", "ignore"] });
	},
};

/** The suffix the CLI puts on a keychain entry for a config directory: `-` and 8 hex of its sha256. */
export function keychainSuffix(dir: string): string {
	return `-${createHash("sha256").update(dir.normalize("NFC")).digest("hex").slice(0, 8)}`;
}

// --- adopting what an account wrote for itself
/**
 * Where an entry that cannot be adopted goes: the account's own directory, not the shared
 * store. It is the account's stale copy of something the shared store already has, so it
 * belongs to that account and goes when the account does (`discard`).
 */
export const DISPLACED = "displaced";

/** A path nothing is using, so moving into it cannot overwrite anything. */
export function freeName(path: string): string {
	if (!existsSync(path)) return path;
	for (let n = 2; n < 100; n += 1) {
		const candidate = `${path}.${n}`;
		if (!existsSync(candidate)) return candidate;
	}
	return `${path}.${Date.now()}`;
}
