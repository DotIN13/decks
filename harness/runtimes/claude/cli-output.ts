/**
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

/** A terminal line as its text, with the escape sequences taken out. */
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
