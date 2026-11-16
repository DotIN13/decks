// The editor, the Google view and the page drawn with fixed host answers: what tools/checks/library/documents-drawn.mjs bundles and compares with its golden.
import { LiveEditor } from "./live.ts";
import { GoogleView } from "./gview.ts";
import { mountDocPage } from "./page.ts";
import { texMeta } from "./tex.ts";

type Item = { kind: "text" | "doc" | "meta" | "page"; path: string; text: string; doc?: unknown; remote?: unknown };
const later = <T>(work: () => T) => new Promise<T>((resolve) => setTimeout(() => resolve(work()), 50));

/** One corpus item drawn, as the text the golden keeps. */
export function drawItem(it: Item): Promise<string> {
	if (it.kind === "text") return drawText(it.path, it.text);
	if (it.kind === "doc") return drawDoc(it.doc, it.text);
	if (it.kind === "meta") return Promise.resolve(JSON.stringify(texMeta(it.text), null, 1));
	return drawPage(it);
}

function drawText(path: string, text: string): Promise<string> {
	const sync = { text, path, readOnly: false, changes: [], marks: [], edit() {}, settled: true } as never;
	const host = {
		marks: () => [],
		changes: () => [],
		math: (into: HTMLElement) => { for (const el of into.querySelectorAll ? [into] : []) el.setAttribute("data-math", "drawn"); },
		asset: async (src: string) => `asset:${src}`,
		pdfPicture: async (src: string) => `pdf:${src}`,
	};
	const editor = new LiveEditor(sync, host as never);
	editor.reset();
	return later(() => { const html = editor.root.innerHTML; editor.destroy(); return html; });
}

function drawDoc(doc: unknown, text: string): Promise<string> {
	const sync = { text, path: "docs/google/x.md", readOnly: false, changes: [], marks: [], edit() {}, settled: true } as never;
	const view = new GoogleView(sync, { marks: () => [], style() {}, selection() {}, drawn() {}, command() {} } as never);
	document.body.append(view.root);
	view.load(doc as never, text);
	return later(() => { const html = view.root.innerHTML; view.root.remove(); return html; });
}

/**
 * A whole page mounted and opened: the order its document listeners, its subscription and its
 * ticker start in, what it sent, and its markup with the editor's drawing left out (the bar, the
 * toolbar's groups, the PDF bar and pane, the divider, the panel).
 */
async function drawPage(it: Item): Promise<string> {
	const order: string[] = [];
	const addListener = document.addEventListener;
	const setTicker = window.setInterval;
	document.addEventListener = function (this: Document, type: string, fn: never, options?: never) {
		const source = String(fn);
		if (type === "mousedown") order.push(source.includes("styleBox") ? "mousedown: style menu" : source.includes("gitBox") ? "mousedown: git menu" : source.includes("googleBox") ? "mousedown: Google menu" : "mousedown: other");
		return addListener.call(this, type, fn, options);
	} as never;
	window.setInterval = ((...args: Parameters<typeof setInterval>) => (order.push("ticker"), setTicker(...args))) as never;
	const sent: string[] = [];
	let hear: ((message: never) => void) | undefined;
	const host = document.createElement("div");
	document.body.append(host);
	const page = mountDocPage(host, { path: it.path, send: (message) => void sent.push(message.type), listen: (listener) => (order.push("listen"), (hear = listener as never), () => {}) });
	document.addEventListener = addListener;
	window.setInterval = setTicker;
	hear?.({ type: "doc.state", path: it.path, asked: it.path, rev: 1, format: "text", text: it.text, changes: [], ...(it.remote ? { remote: it.remote } : {}) } as never);
	return later(() => {
		const copy = host.cloneNode(true) as HTMLElement;
		copy.querySelector(".dp-scroll")?.replaceChildren();
		const out = JSON.stringify({ order, sent, markup: copy.innerHTML }, null, 1);
		page.destroy();
		host.remove();
		return out;
	});
}
