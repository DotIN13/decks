import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { decodeEntities } from "./markdown.ts";

/**
 * A card's fenced code, coloured as GitHub colours it: highlight.js reads the language named after
 * the fence, and each piece it marks takes the colour GitHub's light theme gives that kind of
 * piece. A language it does not know, or none, is left in one colour, as GitHub leaves it.
 */

for (const [name, language] of Object.entries({ bash, c, cpp, css, diff, go, java, javascript, json, kotlin, markdown, php, python, r, ruby, rust, shell, sql, swift, typescript, xml, yaml })) {
	hljs.registerLanguage(name, language);
}
hljs.registerAliases(["html", "svg", "vue"], { languageName: "xml" });
hljs.registerAliases(["sh", "zsh", "console"], { languageName: "bash" });
hljs.registerAliases(["js", "jsx", "mjs", "cjs"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx", "mts"], { languageName: "typescript" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["rs"], { languageName: "rust" });
hljs.registerAliases(["yml"], { languageName: "yaml" });
hljs.registerAliases(["md"], { languageName: "markdown" });
hljs.registerAliases(["kt"], { languageName: "kotlin" });
hljs.registerAliases(["rb"], { languageName: "ruby" });
hljs.registerAliases(["patch"], { languageName: "diff" });

/** GitHub's light theme, by highlight.js's name for the piece. */
const COLOURS: Record<string, string> = {
	keyword: "#cf222e",
	"selector-tag": "#cf222e",
	"template-tag": "#cf222e",
	doctag: "#cf222e",
	title: "#8250df",
	"title.function": "#8250df",
	"title.class": "#953800",
	"title.class.inherited": "#953800",
	string: "#0a3069",
	regexp: "#0a3069",
	"meta.string": "#0a3069",
	number: "#0550ae",
	literal: "#0550ae",
	attr: "#0550ae",
	attribute: "#0550ae",
	variable: "#953800",
	"template-variable": "#953800",
	symbol: "#0550ae",
	"selector-id": "#0550ae",
	"selector-class": "#6639ba",
	"selector-attr": "#0550ae",
	"selector-pseudo": "#0550ae",
	property: "#0550ae",
	meta: "#0550ae",
	built_in: "#953800",
	type: "#953800",
	params: "#1f2328",
	comment: "#59636e",
	quote: "#59636e",
	name: "#116329",
	tag: "#116329",
	section: "#0550ae",
	bullet: "#953800",
	addition: "#116329",
	deletion: "#82071e",
	link: "#0a3069",
	operator: "#cf222e",
};

export interface CodeRun {
	text: string;
	/** A colour from GitHub's theme; none is the code's own colour. */
	colour?: string;
	bold?: boolean;
	italic?: boolean;
}

/** Code in a language, as coloured runs; unknown languages are one run. */
export function highlight(code: string, lang: string): CodeRun[] {
	if (!lang || !hljs.getLanguage(lang)) return [{ text: code }];
	let html: string;
	try {
		html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
	} catch {
		return [{ text: code }];
	}
	const out: CodeRun[] = [];
	const stack: string[] = [];
	const colourOf = () => {
		for (let i = stack.length - 1; i >= 0; i--) {
			const kind = stack[i]!;
			const colour = COLOURS[kind] ?? COLOURS[kind.split(".")[0]!];
			if (colour) return { colour, kind };
		}
		return undefined;
	};
	const pattern = /<span class="hljs-([^"]+)">|<\/span>|([^<]+)/g;
	for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
		if (match[1]) stack.push(match[1].split(" ")[0]!.replace(/_$/, ""));
		else if (match[0] === "</span>") stack.pop();
		else {
			const text = decodeEntities(match[2]!);
			const found = colourOf();
			const run: CodeRun = { text, ...(found ? { colour: found.colour } : {}), ...(found?.kind === "section" || found?.kind === "strong" ? { bold: true } : {}), ...(found?.kind === "emphasis" ? { italic: true } : {}) };
			const last = out.at(-1);
			if (last && last.colour === run.colour && last.bold === run.bold && last.italic === run.italic) last.text += text;
			else out.push(run);
		}
	}
	return out;
}
