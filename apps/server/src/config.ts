import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { AgentKind } from "@decks/protocol";

/**
 * Everything the process is told from outside, read once.
 *
 * One directory holds everything Decks stores, and the deck is `<dataDir>/decks` — one
 * deck per data directory. That is not a preference: a Pi session's working directory
 * cannot move, so a deck *is* a working directory, and "which deck" and "which set of
 * transcripts, revisions and settings" are the same question. Switching decks means
 * pointing at another data directory, which is also how the tests keep out of the way of
 * real work.
 *
 * Ports are 4328/4329 rather than 4318/4319 so a Decks and a Picone can be up at the same
 * time — they are different shells over the same agent, and comparing them side by side is
 * the normal case rather than a special one.
 */
export interface Config {
	host: string;
	port: number;
	/** The application's directory. Everything Decks stores lives under it. */
	dataDir: string;
	/** The deck inside it. Created on first run if it is not there. */
	deck: string;
	/**
	 * Which runtime a new agent gets unless it asks for another.
	 *
	 * A default rather than a setting: both runtimes are available at once and the choice
	 * is per agent (§6.2). This is only what the `+` button hands you.
	 */
	backend: AgentKind;
}

export function expandUser(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	return path;
}

/** The name of the deck directory inside a data directory. */
export const DECK_DIR = "decks";

export function loadConfig(argv: string[] = process.argv.slice(2)): Config {
	/*
	 * A positional argument names a *data directory*, not a deck — `npm start -- ~/other`.
	 * It wins over the environment so a one-off run needs no exported variable.
	 */
	const positional = argv.find((argument) => !argument.startsWith("-"));
	const named = expandUser(positional ?? process.env.DECKS_DATA_DIR ?? "~/.decks");
	const dataDir = isAbsolute(named) ? named : resolve(process.cwd(), named);

	// Anything unrecognised falls back to Pi rather than failing to start: a typo in an
	// environment variable should not cost you the deck.
	const asked = process.env.DECKS_BACKEND;
	const backend: AgentKind = asked === "claude" ? "claude" : "pi";

	return {
		host: process.env.DECKS_HOST ?? "127.0.0.1",
		port: Number(process.env.DECKS_PORT ?? 4329),
		dataDir,
		deck: join(dataDir, DECK_DIR),
		backend,
	};
}
