/**
 * Markdown, parsed to a tree the app builds elements from — never to HTML.
 *
 * This file exists because of the trade the transcript used to refuse. Model output was
 * rendered as plain text, deliberately, on the argument that turning it into HTML means
 * sanitising it — a real dependency and a real attack surface — to gain bold and bullets in
 * a narrow column. The argument was right about HTML and wrong about the conclusion: an
 * agent writes lists, headings and `code` constantly, and a reply that shows its own
 * asterisks is a reply you have to decode.
 *
 * So there is no HTML anywhere in this path. The text becomes a **tree of tokens**, and
 * `Markdown.tsx` builds real elements from it — no `innerHTML`, no `dangerouslySetInnerHTML`,
 * nothing for a sanitiser to get wrong, because a string of markup is never constructed in
 * the first place. The one place a document *can* still be attacked through structured
 * output is a link target, and `safeHref` is the whole of that surface: `http:`, `https:`
 * and `mailto:`, and anything else stays the literal text it was.
 *
 * A subset, on purpose — the blocks an agent actually writes into a chat. Tables, footnotes,
 * reference links and raw HTML are not here; they arrive as their own source text, which is
 * honest and readable, rather than as half-rendered guesses.
 */

export type Inline =
	| { kind: "text"; text: string }
	| { kind: "code"; text: string }
	| { kind: "strong"; spans: Inline[] }
	| { kind: "em"; spans: Inline[] }
	| { kind: "strike"; spans: Inline[] }
	| { kind: "link"; href: string; spans: Inline[] };

/**
 * One line of a list, and how far in it sits.
 *
 * Nesting is a `depth` rather than a tree of lists. A tree is more faithful to the source
 * and buys nothing here: an indented bullet has to be drawn indented either way, and a flat
 * list with a depth is a list the parser can produce in one pass and a test can read in one
 * line. Capped at three, because the fourth level of nesting in a 360px column is not
 * information.
 */
export interface ListItem {
	spans: Inline[];
	depth: number;
}

export type Block =
	| { kind: "paragraph"; spans: Inline[] }
	| { kind: "heading"; level: number; spans: Inline[] }
	| { kind: "code"; text: string; lang: string }
	| { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
	| { kind: "quote"; spans: Inline[] }
	| { kind: "rule" };

/** How deep a nested list item is allowed to get before it stops indenting. */
const MAX_DEPTH = 3;

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const BULLET = /^([ \t]*)([-*+])[ \t]+(.*)$/;
const ORDERED = /^([ \t]*)(\d{1,9})[.)][ \t]+(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w+#.-]*)[ \t]*$/;

/**
 * A reply, as blocks.
 *
 * Line-based and single-pass, which is what makes it safe to run on a *streaming* message:
 * the text grows a token at a time, so every intermediate state has to render as something
 * sensible. An unterminated fence is treated as code to the end rather than as a paragraph
 * beginning with three backticks — so a code block appears as it is typed instead of
 * flickering into place when its closing fence lands.
 */
export function blocks(text: string): Block[] {
	const out: Block[] = [];
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	let paragraph: string[] = [];

	const flush = () => {
		if (paragraph.length === 0) return;
		out.push({ kind: "paragraph", spans: inline(paragraph.join("\n")) });
		paragraph = [];
	};

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] ?? "";

		const fence = FENCE.exec(line);
		if (fence) {
			flush();
			const marker = fence[1]!;
			const char = marker[0]!;
			const body: string[] = [];
			i += 1;
			while (i < lines.length) {
				const candidate = (lines[i] ?? "").trim();
				if (candidate.length >= marker.length && candidate === char.repeat(candidate.length)) break;
				body.push(lines[i] ?? "");
				i += 1;
			}
			out.push({ kind: "code", text: body.join("\n"), lang: fence[2] ?? "" });
			continue;
		}

		if (!line.trim()) {
			flush();
			continue;
		}

		// Before the bullet rule, because `---` and `***` match both and mean this.
		if (RULE.test(line)) {
			flush();
			out.push({ kind: "rule" });
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading) {
			flush();
			out.push({ kind: "heading", level: heading[1]!.length, spans: inline(heading[2] ?? "") });
			continue;
		}

		const quote = QUOTE.exec(line);
		if (quote) {
			flush();
			const body = [quote[1] ?? ""];
			while (i + 1 < lines.length) {
				const next = QUOTE.exec(lines[i + 1] ?? "");
				if (!next) break;
				body.push(next[1] ?? "");
				i += 1;
			}
			out.push({ kind: "quote", spans: inline(body.join("\n")) });
			continue;
		}

		const first = BULLET.exec(line) ?? ORDERED.exec(line);
		if (first) {
			flush();
			const ordered = ORDERED.test(line);
			const items: ListItem[] = [];
			for (;;) {
				const current = lines[i] ?? "";
				const match = (ordered ? ORDERED.exec(current) : BULLET.exec(current)) ?? BULLET.exec(current) ?? ORDERED.exec(current);
				if (!match) break;
				items.push({ spans: inline(match[3] ?? ""), depth: depthOf(match[1] ?? "") });
				if (i + 1 >= lines.length) break;
				const next = lines[i + 1] ?? "";
				if (!BULLET.test(next) && !ORDERED.test(next)) break;
				i += 1;
			}
			const start = ordered ? Number(ORDERED.exec(line)?.[2] ?? 1) : 1;
			out.push({ kind: "list", ordered, start, items });
			continue;
		}

		paragraph.push(line);
	}

	flush();
	return out;
}

/** Leading whitespace as a nesting level. A tab is four columns, the way everything else is. */
function depthOf(indent: string): number {
	const columns = indent.replace(/\t/g, "    ").length;
	return Math.min(MAX_DEPTH, Math.floor(columns / 2));
}

/**
 * A run of text, as spans.
 *
 * Written as a scanner rather than one alternating regex because the rules are about
 * *context*, not shape: a backtick span swallows every other marker inside it, `_` inside a
 * word is not emphasis (an agent writes `file_path` and `snake_case` all day), and emphasis
 * does not open on a space. Each of those is a line here and would be an unreadable
 * lookaround there.
 */
export function inline(text: string): Inline[] {
	const spans: Inline[] = [];
	let buffer = "";

	const flushText = () => {
		if (!buffer) return;
		spans.push({ kind: "text", text: buffer });
		buffer = "";
	};
	const push = (span: Inline) => {
		flushText();
		spans.push(span);
	};

	let i = 0;
	while (i < text.length) {
		const ch = text[i]!;

		// An escape is the next character, literally — this is how a reply writes an asterisk.
		if (ch === "\\" && i + 1 < text.length) {
			buffer += text[i + 1];
			i += 2;
			continue;
		}

		// Code wins over everything: nothing inside backticks is markup.
		if (ch === "`") {
			const run = /^`+/.exec(text.slice(i))![0];
			const close = text.indexOf(run, i + run.length);
			if (close !== -1) {
				push({ kind: "code", text: text.slice(i + run.length, close).trim() });
				i = close + run.length;
				continue;
			}
		}

		if (ch === "[") {
			const link = matchLink(text, i);
			if (link) {
				// An unsafe or unparseable target stays the text it was, brackets and all —
				// silently dropping it would hide from the reader that a link was written.
				if (link.href) push({ kind: "link", href: link.href, spans: inline(link.label) });
				else buffer += text.slice(i, link.end);
				i = link.end;
				continue;
			}
		}

		const opened = openEmphasis(text, i);
		if (opened) {
			push({ kind: opened.kind, spans: inline(text.slice(i + opened.marker.length, opened.close)) });
			i = opened.close + opened.marker.length;
			continue;
		}

		buffer += ch;
		i += 1;
	}

	flushText();
	return spans;
}

/**
 * The emphasis markers, longest first so `**` is never read as two `*`.
 *
 * **`_` is not one of them, and that is a deliberate break with markdown.** Underscores in
 * an agent's replies are overwhelmingly *names* — `file_path`, `snake_case`, `MAX_DEPTH`,
 * and above all Python's dunders. A word-boundary guard rescues most of those but not
 * `__init__`, which every rule that treats `__` as bold renders as **init**: the two
 * characters that carry the meaning are exactly the two it eats. Meanwhile no model in
 * practice reaches for `_` to emphasise anything; they all write `*`. So one marker family
 * does emphasis, underscores are literal characters, and no identifier can be mangled.
 */
const MARKERS = [
	{ marker: "**", kind: "strong" as const },
	{ marker: "~~", kind: "strike" as const },
	{ marker: "*", kind: "em" as const },
];

function openEmphasis(text: string, at: number): { marker: string; kind: "strong" | "em" | "strike"; close: number } | undefined {
	for (const { marker, kind } of MARKERS) {
		if (!text.startsWith(marker, at)) continue;
		// Emphasis opens on content, not on a space: `2 * 3 * 4` is arithmetic.
		const after = text[at + marker.length];
		if (after === undefined || /\s/.test(after)) continue;
		const close = findClose(text, at + marker.length, marker);
		if (close === -1) continue;
		return { marker, kind, close };
	}
	return undefined;
}

function findClose(text: string, from: number, marker: string): number {
	const char = marker[0]!;
	let i = from;
	while (i < text.length) {
		const ch = text[i]!;
		if (ch === "\\") {
			i += 2;
			continue;
		}
		// Skip whole code spans, so a marker inside one cannot close emphasis outside it.
		if (ch === "`") {
			const run = /^`+/.exec(text.slice(i))![0];
			const close = text.indexOf(run, i + run.length);
			i = close === -1 ? i + run.length : close + run.length;
			continue;
		}
		if (text.startsWith(marker, i) && i > from) {
			// It does not close on a space either, for the same reason it does not open on one.
			if (/\s/.test(text[i - 1] ?? " ")) {
				i += marker.length;
				continue;
			}
			/*
			 * Close at the *end* of the marker run, not its start.
			 *
			 * `***both***` is bold-and-italic: the outer `**` has to take the last two
			 * asterisks so the `*both*` between them is left for the recursion. Closing at
			 * the first asterisk of the run instead gave `strong("*both")` and a stray
			 * asterisk after it — which is what this looked like before.
			 */
			const run = /^\*+|^~+/.exec(text.slice(i))?.[0]?.length ?? marker.length;
			return run > marker.length && text[i] === char ? i + (run - marker.length) : i;
		}
		i += 1;
	}
	return -1;
}

/** `[label](target)`, with the label allowed its own markup and the target checked. */
function matchLink(text: string, at: number): { label: string; href: string | undefined; end: number } | undefined {
	let depth = 0;
	let i = at;
	for (; i < text.length; i += 1) {
		const ch = text[i];
		if (ch === "\\") {
			i += 1;
			continue;
		}
		if (ch === "[") depth += 1;
		if (ch === "]") {
			depth -= 1;
			if (depth === 0) break;
		}
		if (ch === "\n") return undefined;
	}
	if (depth !== 0 || text[i + 1] !== "(") return undefined;
	const close = text.indexOf(")", i + 2);
	if (close === -1) return undefined;
	const target = text.slice(i + 2, close);
	if (/\s/.test(target.trim())) return undefined;
	return { label: text.slice(at + 1, i), href: safeHref(target), end: close + 1 };
}

/**
 * A link target a click can safely follow, or nothing.
 *
 * The entire attack surface of this path, so it is an allowlist and not a denylist:
 * `javascript:` is the obvious one to keep out, `data:` can carry a document, and a
 * *relative* target is its own problem here — this is a single-page app, and following one
 * would unload the socket, the camera and the transcript to show a file. Three schemes are
 * allowed and everything else stays literal text.
 */
function safeHref(raw: string): string | undefined {
	const href = raw.trim();
	if (!href) return undefined;
	return /^(?:https?:\/\/|mailto:)[^\s]+$/i.test(href) ? href : undefined;
}

/**
 * The same text with its markup taken off, for somewhere too small to render it.
 *
 * The dock's peek is one or two lines in a strip over the input bar, so it cannot draw a
 * list or a heading — but showing raw `**` there while the bubble below renders it bold is
 * the app disagreeing with itself in two places at once.
 */
export function plainText(text: string): string {
	const say = (spans: Inline[]): string =>
		spans
			.map((span) => (span.kind === "text" || span.kind === "code" ? span.text : say(span.spans)))
			.join("");
	return blocks(text)
		.map((block) => {
			switch (block.kind) {
				case "code":
					return block.text;
				case "rule":
					return "";
				case "list":
					return block.items.map((item) => `• ${say(item.spans)}`).join("\n");
				default:
					return say(block.spans);
			}
		})
		.filter((line) => line.length > 0)
		.join("\n");
}
