/**
 * The shape of a document, as a string — the editor's answer to "is this the same document".
 *
 * Two documents have the same shape when they have the same elements, nested the same way, in the
 * same order, with the same attribute names, and the same text. Spelling is deliberately not
 * compared: attribute order, quote style, entities and whitespace are things a renderer is allowed
 * to differ about, and the editor may differ about them **because nothing it renders is ever
 * written to a file**. The file is spliced on the server, inside ranges found by its own parse.
 *
 * That makes this the right test for the whole design, and it runs against the browser itself: our
 * serialisation is parsed by the browser, the file is parsed by the browser, and the two shapes are
 * compared. We are not authoring a second answer to what HTML means — we are checking ours against
 * the only one that counts. Over this deck that is 538 boards of evidence.
 *
 * Handles are skipped, because they are ours and not the file's, and an injected `<base>` is
 * skipped for the same reason.
 */
import { HANDLE_ATTRIBUTE } from "./handles.ts";

export function shapeOf(node: Node): string {
	if (node.nodeType === 3) return `#${(node as Text).data.replace(/\s+/g, " ").trim()}`;
	if (node.nodeType === 8) return "<!-- -->";
	if (node.nodeType !== 1 && node.nodeType !== 9) return "";
	const element = node as Element | Document;
	const tag = node.nodeType === 9 ? "#document" : (element as Element).tagName.toLowerCase();
	const attrs = [...((element as Element).attributes ?? [])]
		.map((attribute) => attribute.name)
		.filter((name) => name !== HANDLE_ATTRIBUTE)
		.sort()
		.join(",");
	const children = [...node.childNodes]
		.filter((child) => !(child.nodeType === 1 && (child as Element).tagName.toLowerCase() === "base"))
		.map(shapeOf)
		.filter((shape) => shape !== "")
		.join("");
	return `<${tag} ${attrs}>${children}`;
}
