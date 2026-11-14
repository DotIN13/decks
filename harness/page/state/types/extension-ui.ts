/** A runtime's dialog surface, serialised — Pi's widget API, and Claude's questions. */
export interface WidgetSpan {
	text: string;
	role?: string;
	bold?: boolean;
}
export type WidgetLine = WidgetSpan[];

export type ExtensionUiPrompt =
	| { id: string; method: "select"; title: string; options: string[] }
	| { id: string; method: "confirm"; title: string; message: string }
	| { id: string; method: "input"; title: string; placeholder?: string }
	| { id: string; method: "editor"; title: string; prefill?: string }
	| { id: string; method: "custom"; lines: WidgetLine[] }
	/**
	 * A question with reasons attached, which `select` cannot carry.
	 *
	 * Claude Code's `AskUserQuestion` is the caller: two to four options, each with a
	 * sentence saying what choosing it would mean, and that sentence is the part worth
	 * reading — "Hybrid" and "All utilities" are indistinguishable without it. `select`
	 * has bare strings and no room to put one.
	 *
	 * The answer is `{ value }` in both shapes: for `multiple`, the picked labels joined
	 * with ", ", which is the format the tool's own output specifies for a multi-select.
	 * `other` adds a free-text escape, because a question with four answers and no way to
	 * say "none of those" is a question that traps you.
	 */
	| {
			id: string;
			method: "choose";
			title: string;
			message?: string;
			options: { label: string; description?: string }[];
			multiple?: boolean;
			other?: boolean;
	  }
	/**
	 * Sign-in: a URL to open, and the code the browser hands back.
	 *
	 * Claude Code's OAuth flow is a paste-the-code flow — it prints a URL and then waits
	 * on stdin — so a login dialog that only said "done" could never finish one. The
	 * answer is the code (`{ value }`); `{ confirmed: true }` is the app closing the
	 * dialog itself because the credentials landed without one.
	 */
	| { id: string; method: "login"; title: string; message: string; url: string; placeholder?: string };
/*
 * There was a `usage` method here: a title and a list of pre-formatted `label: value`
 * strings, which both backends filled in and the dock drew as a card above the input bar.
 * It is gone, and what replaced it is `UsageReport` — structured, read on demand, and drawn
 * by a panel that can put a meter next to a window and a countdown under it. A runtime
 * formatting its own numbers into strings is a runtime deciding how they are drawn, which
 * is how "42% (148000 / 200000 tokens)" ended up being the whole of what the app knew.
 */

export type ExtensionUiAnswer =
	| { id: string; value: string }
	| { id: string; confirmed: boolean }
	| { id: string; cancelled: true };
