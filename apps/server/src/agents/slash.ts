import type { SlashCommand } from "@decks/protocol";
import type { AgentBackendContext } from "./backend.ts";

/**
 * A prompt that starts with `/`, split into its command and its argument.
 *
 * Shared by both backends, because the deck interprets a small set of commands for
 * each runtime and they should agree on what a command is: exactly `/name`, then
 * optional whitespace and whatever else the person typed. Only `/` alone — a slash
 * with nothing after it— is not a command.
 */
export function parseSlash(text: string): { name: string; args: string } | undefined {
	const match = /^\/([A-Za-z][A-Za-z0-9_-]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
	if (!match) return undefined;
	return { name: match[1]!.toLowerCase(), args: match[2] ?? "" };
}
/**
 * The deck's own commands, then the runtime's, with the runtime's duplicates dropped.
 *
 * A runtime declares dozens — Claude Code alone is around sixty once skills and a
 * project's own `commands/` are counted — and offering them is most of what makes the
 * `/` menu worth opening. But a handful of names exist on both sides: the deck's
 * `/login` runs the CLI's `auth login` through the dock's dialogs because the CLI
 * refuses `/login` headless, and the deck's `/cost` opens the usage panel rather than
 * printing a paragraph. Those are the ones wired to something, so those are the ones
 * that win, and the runtime's namesake is dropped rather than listed twice.
 *
 * Aliases are claimed as well as names. Claude resolves `/cost` to `/usage`, so a merge
 * that only compared names would list `/usage` beside the deck's `/cost` — two rows for
 * the same reading, one of which goes somewhere else.
 */
export function mergeCommands(deck: SlashCommand[], runtime: SlashCommand[]): SlashCommand[] {
	const claimed = new Set<string>();
	for (const command of deck) {
		claimed.add(command.name.toLowerCase());
		for (const alias of command.aliases ?? []) claimed.add(alias.toLowerCase());
	}
	const seen = new Set(claimed);
	const rest: SlashCommand[] = [];
	for (const command of runtime) {
		const name = command.name.toLowerCase();
		if (claimed.has(name) || (command.aliases ?? []).some((alias) => claimed.has(alias.toLowerCase()))) continue;
		// A runtime that declares the same name twice — a skill shadowing a builtin — is
		// listed once, at the position of the first.
		if (seen.has(name)) continue;
		seen.add(name);
		rest.push(command);
	}
	return [...deck, ...rest];
}

/** Whether two menus say the same thing, so an unchanged list is not republished. */
export function sameCommands(a: SlashCommand[], b: SlashCommand[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((command, index) => command.name === b[index]!.name && command.hint === b[index]!.hint && command.arg === b[index]!.arg);
}

/**
 * What `/help` says, now that the answer can be sixty commands long.
 *
 * The deck's own get a line each, because they are the ones whose behaviour is the
 * deck's and nowhere else written down. The runtime's are named and not described: a
 * transcript is not a reference manual, and the `/` menu — which shows every hint next
 * to every name, and filters — is the reference manual.
 */
function helpText(commands: SlashCommand[]): string {
	if (commands.length === 0) return "No commands.";
	const deck = commands.filter((command) => command.source === "deck");
	const rest = commands.filter((command) => command.source !== "deck");
	const lines = deck.map((command) => `/${command.name}${command.arg ? ` ${command.arg}` : ""}: ${command.hint ?? ""}`);
	if (rest.length > 0) {
		lines.push("");
		lines.push(`And ${rest.length} from the runtime — type / to see them: ${rest.map((command) => `/${command.name}`).join(" ")}`);
	}
	return lines.join("\n");
}

/**
 * What a runtime tells the deck so the deck can answer its own commands for it.
 *
 * `/cost`, `/help`, `/status` and `/models` mean the same thing on every runtime, and each
 * backend used to answer them in its own `runSlash`, with its own status format. The facts are
 * the runtime's; the answers are written here, once.
 */
export interface DeckSlashFacts {
	/** The runtime's name, which `/status` opens with: `Claude Code`, `opencode`. */
	runtime: string;
	/** The menu, for `/help`. */
	commands(): SlashCommand[];
	/**
	 * What `/status` says after the name, each a short phrase (`model x`, `mode auto`); an
	 * undefined one is left out. Absent when the deck does not answer `/status` for this
	 * runtime, so it is handed to the runtime.
	 */
	status?(): Array<string | undefined> | Promise<Array<string | undefined>>;
	/** What `/models` says. Absent when the deck does not answer `/models` for this runtime. */
	models?(): string;
}

/** One status line, the same on every runtime: the name, then its facts, between middle dots. */
function statusLine(runtime: string, facts: Array<string | undefined>): string {
	return [runtime, ...facts.filter((fact): fact is string => fact !== undefined)].join(" · ");
}

/**
 * Answer a deck-owned command, or say it is not one.
 *
 * True when the command was answered here; false for anything else, which the runtime then
 * runs as its own. `/cost` opens the usage panel rather than printing a paragraph: the shell
 * reads the figures and sends them with the instruction to open it (`session.pushReport`).
 */
export async function deckSlash(name: string, context: Pick<AgentBackendContext, "notice" | "showUsage">, facts: DeckSlashFacts): Promise<boolean> {
	switch (name) {
		case "cost":
			context.showUsage?.();
			return true;
		case "help":
			context.notice("info", helpText(facts.commands()));
			return true;
		case "status":
			if (!facts.status) return false;
			context.notice("info", statusLine(facts.runtime, await facts.status()));
			return true;
		case "models":
			if (!facts.models) return false;
			context.notice("info", facts.models());
			return true;
		default:
			return false;
	}
}
