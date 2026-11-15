import type { SlashCommand } from "@decks/protocol";

/** Fifty at a time. */
const MAX_MATCHES = 50;

/** Filter and rank: the exact name first, then prefixes, then substrings. */
export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
	const needle = query.toLowerCase();
	if (!needle) return commands.slice(0, MAX_MATCHES);
	const exact: SlashCommand[] = [];
	const prefix: SlashCommand[] = [];
	const contains: SlashCommand[] = [];
	for (const command of commands) {
		const names = [command.name, ...(command.aliases ?? [])].map((name) => name.toLowerCase());
		if (names.includes(needle)) exact.push(command);
		else if (names.some((name) => name.startsWith(needle))) prefix.push(command);
		else if (names.some((name) => name.includes(needle))) contains.push(command);
	}
	return [...exact, ...prefix, ...contains].slice(0, MAX_MATCHES);
}

/** What the badge at the end of a row says. */
export function badge(command: SlashCommand, runtime: string): string {
	switch (command.source) {
		case "deck":
			return "decks";
		case "skill":
			return "skill";
		case "prompt":
			return "prompt";
		case "extension":
			return "ext";
		case "runtime":
			return runtime;
		default:
			return "";
	}
}
