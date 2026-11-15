/**
 * How a block reads: LaTeX turned into HTML for the commands a paper mostly uses, with the maths
 * left in its delimiters for KaTeX. Markdown is drawn
 * by the host's own renderer (`DocPageOptions.markdown`), so a document reads like every other
 * markdown in the app.
 */

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `\name{…}` with its balanced argument, replaced by what `wrap` makes of the argument. */
function command(text: string, names: string, wrap: (inner: string, name: string) => string): string {
	const re = new RegExp(`\\\\(${names})\\*?\\s*(\\[[^\\]]*\\])?\\{`, "g");
	let out = "";
	let at = 0;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		let depth = 1;
		let i = re.lastIndex;
		for (; i < text.length && depth > 0; i++) {
			if (text[i] === "\\") i++;
			else if (text[i] === "{") depth++;
			else if (text[i] === "}") depth--;
		}
		if (depth !== 0) break;
		out += text.slice(at, m.index) + wrap(text.slice(re.lastIndex, i - 1), m[1]!);
		at = i;
		re.lastIndex = i;
	}
	return out + text.slice(at);
}

/** Inline LaTeX: emphasis, code, references and the characters TeX escapes. Maths is left alone. */
function texInline(source: string): string {
	// Maths first, set aside so nothing below touches it.
	const maths: string[] = [];
	let text = source.replace(/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+\$)/g, (m) => `\u0000${maths.push(m) - 1}\u0000`);
	text = text.replace(/(^|[^\\])%.*$/gm, "$1");
	text = escapeHtml(text);
	text = command(text, "textbf", (x) => `<b>${x}</b>`);
	text = command(text, "emph|textit", (x) => `<i>${x}</i>`);
	text = command(text, "texttt", (x) => `<code>${x}</code>`);
	text = command(text, "underline", (x) => `<u>${x}</u>`);
	text = command(text, "cite|citep|citet|parencite|textcite", (x) => `<span class="dp-cite">[${x}]</span>`);
	text = command(text, "ref|eqref|autoref|cref|Cref", (x) => `<span class="dp-cite">(${x})</span>`);
	text = command(text, "url", (x) => `<span class="dp-link">${x}</span>`);
	text = command(text, "href", (x) => `<span class="dp-link">${x}</span>`);
	text = command(text, "footnote", (x) => `<sup class="dp-note" title="${x.replace(/"/g, "&quot;")}">*</sup>`);
	text = command(text, "label|vspace|hspace|index", () => "");
	// Any other one-argument command shows its argument.
	text = command(text, "[a-zA-Z]+", (x) => x);
	text = text
		.replace(/``/g, "“")
		.replace(/''/g, "”")
		.replace(/---/g, "—")
		.replace(/--/g, "–")
		.replace(/~/g, " ")
		.replace(/\\([%&$#_{}])/g, "$1")
		.replace(/\\\\/g, "<br>")
		.replace(/\\[a-zA-Z]+\s?/g, "");
	return text.replace(/\u0000(\d+)\u0000/g, (_m, n) => escapeHtml(maths[Number(n)]!));
}

const SECTION: Record<string, string> = { part: "h1", chapter: "h1", section: "h2", subsection: "h3", subsubsection: "h4", paragraph: "h5" };
const DISPLAY = /\\begin\{(equation|align|gather|multline|eqnarray)(\*?)\}([\s\S]*?)\\end\{\1\2\}/g;

/** One LaTeX block as HTML. */
export function texToHtml(block: string): string {
	let text = block.trim();
	if (!text) return "";
	// Display maths into one form KaTeX's auto-render reads.
	text = text.replace(DISPLAY, (_m, env: string, _star, body: string) => {
		const clean = body.replace(/\\label\{[^}]*\}/g, "").replace(/\\nonumber/g, "").trim();
		return env === "equation" ? `\\[${clean}\\]` : `\\[\\begin{aligned}${clean}\\end{aligned}\\]`;
	});
	const heading = /^\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\{([\s\S]*?)\}\s*([\s\S]*)$/.exec(text);
	if (heading) {
		const tag = SECTION[heading[1]!]!;
		return `<${tag}>${texInline(heading[2]!)}</${tag}>${heading[3] ? texToHtml(heading[3]) : ""}`;
	}
	const list = /^\\begin\{(itemize|enumerate|description)\}([\s\S]*?)\\end\{\1\}$/.exec(text);
	if (list) {
		const tag = list[1] === "enumerate" ? "ol" : "ul";
		const items = list[2]!.split(/\\item\b(?:\[[^\]]*\])?/).slice(1);
		return `<${tag}>${items.map((item) => `<li>${texInline(item.trim())}</li>`).join("")}</${tag}>`;
	}
	const env = /^\\begin\{(figure|table)\*?\}([\s\S]*?)\\end\{\1\*?\}$/.exec(text);
	if (env) {
		const caption = /\\caption\{([\s\S]*?)\}\s*(\\label|\\end|$)/.exec(env[2]!)?.[1] ?? "";
		return `<div class="dp-box">${env[1] === "figure" ? "Figure" : "Table"}${caption ? `: ${texInline(caption)}` : ""}</div>`;
	}
	if (/^\\begin\{abstract\}/.test(text)) {
		return `<div class="dp-abstract"><b>Abstract.</b> ${texInline(text.replace(/\\(begin|end)\{abstract\}/g, ""))}</div>`;
	}
	if (/^\\(maketitle|tableofcontents|bibliography|bibliographystyle|newpage|clearpage|end\{document\})/.test(text)) {
		return `<div class="dp-chip">${escapeHtml(text.split("\n")[0]!)}</div>`;
	}
	return `<p>${texInline(text)}</p>`;
}
