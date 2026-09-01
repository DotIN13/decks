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