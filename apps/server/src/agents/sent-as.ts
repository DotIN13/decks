/**
 * Whether a message in a runtime's session is the one the transcript shows.
 *
 * The session holds what the model was sent, which is not always what was typed: the session
 * prefixes reminders (`identityReminder`, `canvasNameReminder`, a board the user moved),
 * followed by a blank line, and a runtime may append to the end. So the shown text is either
 * where the sent text starts or right after a blank line in it. Comparing the start alone
 * paired nothing after the first reminder, and those messages had no rewind, fork or preview.
 */
export function sentAs(content: unknown, shown: string): boolean {
	const text =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content.map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "")).join("")
				: "";
	const typed = shown.trimStart();
	const sent = text.trimStart();
	return sent.startsWith(typed) || sent.includes(`\n\n${typed}`);
}
