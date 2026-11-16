// The corpus as items to draw: each markdown and LaTeX file through the editor, each LaTeX file's
// numbering (texMeta), the Google Doc through its view, and three whole pages mounted.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function corpus(folder) {
	const items = [];
	for (const name of readdirSync(folder).sort()) {
		const text = () => readFileSync(join(folder, name), "utf8");
		if (name.endsWith(".md") || name.endsWith(".tex")) items.push({ name, kind: "text", path: `docs/${name}`, text: text() });
		if (name.endsWith(".tex")) items.push({ name: `${name} texMeta`, kind: "meta", text: text() });
		if (name === "google-doc.json") items.push({ name, kind: "doc", ...JSON.parse(text()) });
	}
	const of = (name) => items.find((it) => it.name === name);
	items.push({ name: "page: every-latex.tex", kind: "page", path: "docs/every-latex.tex", text: of("every-latex.tex").text });
	items.push({ name: "page: every-markdown.md", kind: "page", path: "docs/every-markdown.md", text: of("every-markdown.md").text });
	items.push({ name: "page: google-doc.json", kind: "page", path: "docs/google/x.md", text: of("google-doc.json").text, remote: { kind: "google", title: "A Doc", url: "https://docs.google.com/document/d/x" } });
	return items;
}
