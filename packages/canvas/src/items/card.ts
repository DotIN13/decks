import { readingOfCard } from "./card-reading.ts";
import { freshAddress, passless } from "../host.ts";
/**
 * A card: a piece of HTML drawn in a closed shadow root of the stage's own page, where a board has a
 * frame of its own.
 *
 * A frame is a whole document: its own copy of the styles, of every library its scripts import, and,
 * sandboxed, a process of its own; and wheel, pinch and touch inside it reach the stage only by
 * message. A card is a few elements in the page that is already there. Its styles stay inside its
 * root, its events bubble out of it to the stage as any element's do, and a library two cards import
 * is read and run once for the page (`import` keeps one copy per address).
 *
 * The price is that a shadow root fences styles, not code: a card's script runs as the page does.
 * So only the deck's own cards run scripts, as its own boards run theirs; a card from a canvas a
 * friend shared is cleaned of anything that runs before it is placed (`clean`).
 *
 * ### A card's scripts
 *
 * Each inline script is a module, served at its own address beside the card (`sales.html.m0.js`,
 * the server's `boards/cards.ts`), so `import "./sales.js"` resolves from the card's folder and the
 * page's import map names the shared libraries. A module runs once per address; its default export
 * is called for each placement of the card each time it wakes, with the card (`CardContext`), and
 * what it returns is called when the card sleeps or goes.
 *
 * ### What a card can do
 *
 * Its buttons are wired in its module, as any page's are, and act through `card.decks`: the SDK's
 * calls by their names (`await card.decks.canvas.insert(item, { beside })`, `card.decks.now()`).
 * Where each is answered is the canvas's to say (`CanvasHost.cardCall`); in the canvas frame, the
 * view and the time in the frame, the canvas's own calls by the harness, an agent's by the app's
 * page, which asks you before anything is sent to one, and nothing that reaches past the canvas.
 */

/**
 * The SDK as a card has it: every call by its group and name, `card.decks.canvas.read()`, answering a
 * promise of its value. A call the canvas does not let a card make rejects with why.
 */
export type CardDecks = { [group: string]: { [call: string]: (...args: unknown[]) => Promise<unknown> } } & {
	here(): Promise<unknown>;
	now(): Promise<unknown>;
};

/** `card.decks`, its calls made by `call` with the dotted name: `decks.canvas.insert(…)` is `call("canvas.insert", […])`. */
export function cardDecks(call: ((verb: string, args: unknown[]) => Promise<unknown>) | undefined): CardDecks {
	const at = (path: readonly string[]): unknown =>
		new Proxy(function () {}, {
			// `then` is no call: awaiting `card.decks` or a group must not look like a promise.
			get: (_target, key) => (typeof key === "string" && key !== "then" ? at([...path, key]) : undefined),
			apply: (_target, _self, args: unknown[]) => {
				const verb = path.join(".");
				if (!call) return Promise.reject(new Error(`${verb}: this canvas gives cards no calls here.`));
				return call(verb, args);
			},
		});
	return at([]) as CardDecks;
}

/** What a card's script is handed: its own root, and what the stage knows of it. */
export interface CardContext {
	/** The card's closed shadow root: what `document` is to a board. `querySelector` and `getElementById` work on it. */
	root: ShadowRoot;
	/**
	 * The root dressed as a document, for a script written for a board: `body` and `documentElement`
	 * are the card's own element, `createElement` and the rest are the page's.
	 */
	document: Document;
	/** Aborted when the card sleeps or is removed: pass it to listeners and `fetch`, and they stop by themselves. */
	signal: AbortSignal;
	/** The card's own address, for files beside it. */
	url: string;
	/** The address of a file in the card's own folder: `card.file("data.json")`. */
	file(name: string): string;
	/** "light" or "dark", as the canvas is now; `on("theme")` hears a change. */
	theme: "light" | "dark";
	/** The card's box on the canvas. */
	size: { w: number; h: number };
	/** The card's own custom elements, where the browser keeps a registry per root; the page's otherwise. */
	elements: CustomElementRegistry;
	/** Storage of its own: keys kept under the card's path, so two cards never read each other's. */
	store: Pick<Storage, "getItem" | "setItem" | "removeItem">;
	/** Hear a change of the theme or the size. */
	on(what: "theme" | "size", listener: () => void): void;
	/** The SDK, as this card (`CardDecks`): `await card.decks.canvas.insert(item, { beside: card.path })`. */
	decks: CardDecks;
	/** The card's deck path, as the canvas names it. */
	path: string;
}

export type CardCleanup = void | (() => void);

/** What a card runs with: its file's text and address, and whether its scripts may run. */
export interface CardSource {
	html: string;
	url: string;
	path: string;
	/** The deck's own card: its scripts run. A card from a friend's canvas is cleaned first. */
	trusted: boolean;
	theme: "light" | "dark";
	size: { w: number; h: number };
	/** How its `card.decks` calls are answered (`CanvasHost.cardCall`), with this card as the caller. */
	call?: (verb: string, args: unknown[]) => Promise<unknown>;
}

export interface MountedCard {
	root: ShadowRoot;
	setTheme(theme: "light" | "dark"): void;
	setSize(size: { w: number; h: number }): void;
	/** Hear the card's content height, in its own pixels, as it lays out and whenever it changes. */
	onHeight(listener: (h: number) => void): void;
	/** How the card reads now: words, smallest type, spill and cut boxes (`card-reading.ts`), for `fit`. */
	reading(): ReturnType<typeof readingOfCard>;
	/** Stop its scripts and empty it. */
	dispose(): void;
}

/** A script's type that is JavaScript a card runs: none, a module, or a plain script. The server counts the same ones. */
const RUNS = /^(?:|module|text\/javascript|application\/javascript)$/i;
const runs = (script: HTMLScriptElement) => RUNS.test(script.getAttribute("type") ?? "");

/** Elements a shared card may not hold: anything that runs, or opens a page of its own. */
const DROPPED = new Set(["script", "iframe", "frame", "object", "embed", "applet", "base", "meta", "link", "portal", "noscript"]);
/** Attributes that hold an address. */
const ADDRESSES = ["href", "src", "action", "formaction", "poster", "xlink:href", "srcset", "background", "data"];

/** Whether an address stays in the deck: relative, or on this page's own origin. */
function inDeck(value: string, base: string): boolean {
	const trimmed = value.trim();
	if (!trimmed || trimmed.startsWith("#")) return true;
	try {
		const url = new URL(trimmed, base);
		return url.origin === location.origin && url.protocol !== "javascript:";
	} catch {
		return false;
	}
}

/**
 * A friend's card with nothing in it that runs or reaches out: no script, no `on…` attribute, no
 * `javascript:` link, no frame or plugin, and no address outside the deck, in an attribute or a
 * stylesheet. What is left is HTML and CSS.
 */
export function clean(fragment: DocumentFragment, base: string): void {
	const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT);
	const gone: Element[] = [];
	for (let node = walker.nextNode() as Element | null; node; node = walker.nextNode() as Element | null) {
		const name = node.localName;
		if (DROPPED.has(name)) {
			gone.push(node);
			continue;
		}
		// An SVG animation can write an address into a link after the cleaning: one that targets an address goes.
		if (/^(?:animate|set|animatemotion|animatetransform)$/i.test(name) && /href|src|action/i.test(node.getAttribute("attributeName") ?? "")) {
			gone.push(node);
			continue;
		}
		for (const attr of [...node.attributes]) {
			const key = attr.name.toLowerCase();
			if (key.startsWith("on")) node.removeAttribute(attr.name);
			else if (ADDRESSES.includes(key) && !attr.value.split(",").every((part) => inDeck(part.trim().split(/\s+/)[0] ?? "", base))) node.removeAttribute(attr.name);
			else if (key === "style" && /url\s*\(|expression\s*\(/i.test(attr.value) && !cssInDeck(attr.value, base)) node.removeAttribute(attr.name);
		}
		if (name === "form") node.removeAttribute("action"), node.setAttribute("method", "dialog");
		if (name === "style" && !cssInDeck(node.textContent ?? "", base)) node.textContent = cleanCss(node.textContent ?? "", base);
	}
	for (const node of gone) node.remove();
}

/** CSS from a friend's card with its imports gone and every address outside the deck made `none`. */
function cleanCss(css: string, base: string): string {
	return css.replace(/@import[^;]*;/gi, "").replace(/url\s*\(([^)]*)\)/gi, (all, inner: string) => (inDeck(inner.replace(/["']/g, "").trim(), base) ? all : "none"));
}

/** A relative address made absolute against the card's own, leaving `#`, `data:` and the like as they are. */
function fromCard(value: string, base: string): string {
	const trimmed = value.trim();
	if (!trimmed || /^(?:#|[a-z][a-z0-9+.-]*:)/i.test(trimmed)) return value;
	try {
		return new URL(trimmed, base).href;
	} catch {
		return value;
	}
}

/** CSS with its relative `url()`s and `@import`s made absolute against the card. */
function cssFromCard(css: string, base: string): string {
	return css
		.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (_all, quote: string, address: string) => `url(${quote}${fromCard(address, base)}${quote})`)
		.replace(/@import\s+(["'])([^"']+)\1/gi, (_all, quote: string, address: string) => `@import ${quote}${fromCard(address, base)}${quote}`);
}

/**
 * Every relative address in a card made absolute against the card's own (`cards/sales@<rev>/index.html`).
 * In a shadow root an element's address resolves against the page it is in, not the file it came
 * from: `card.css` beside a card would be asked of the app's own address.
 */
function addressesFromCard(fragment: DocumentFragment, base: string): void {
	for (const node of fragment.querySelectorAll("*")) {
		for (const attr of [...node.attributes]) {
			const key = attr.name.toLowerCase();
			if (key === "srcset") node.setAttribute(attr.name, attr.value.split(",").map((part) => part.trim().replace(/^(\S+)/, (address) => fromCard(address, base))).join(", "));
			else if (ADDRESSES.includes(key)) node.setAttribute(attr.name, fromCard(attr.value, base));
			else if (key === "style" && /url\(/i.test(attr.value)) node.setAttribute(attr.name, cssFromCard(attr.value, base));
		}
		if (node.localName === "style") node.textContent = cssFromCard(node.textContent ?? "", base);
		// A template's content is a fragment of its own, which `querySelectorAll` does not enter; what is stamped from it is the card's too.
		if (node instanceof HTMLTemplateElement) addressesFromCard(node.content, base);
	}
}

function cssInDeck(css: string, base: string): boolean {
	if (/@import/i.test(css)) return false;
	for (const match of css.matchAll(/url\s*\(([^)]*)\)/gi)) if (!inDeck((match[1] ?? "").replace(/["']/g, ""), base)) return false;
	return true;
}

/*
 * board.css for a shadow root: the board tokens and parts, with `:root` and the page's `html` and
 * `body.board` turned into the card's own host and element. One sheet for every card on the page,
 * adopted by each root, and the fonts declared once in the page itself, since a shadow root's
 * `@font-face` is not used.
 */
const sheets = new Map<string, Promise<CSSStyleSheet | undefined>>();
const cardSheets = new WeakSet<CSSStyleSheet>();
/** Whether a sheet is the one every card adopts (board.css as the card's): a card's snapshot loads board.css instead (`card-snapshot.ts`). */
export const isCardSheet = (sheet: CSSStyleSheet): boolean => cardSheets.has(sheet);
const fontsSaid = new Set<string>();
/** A response's text, or a failure for one refused or missing. */
const textOf = (response: Response): Promise<string> => (response.ok ? response.text() : Promise.reject(new Error(`${response.url}: ${response.status}`)));
function cardSheet(lib: string): Promise<CSSStyleSheet | undefined> {
	// One sheet whatever pass `lib` was read on (`host.ts`).
	const key = passless(lib);
	let made = sheets.get(key);
	if (made) return made;
	made = (async () => {
		try {
			const [theme, board] = await Promise.all([fetch(new URL("theme.css", lib)).then(textOf), fetch(new URL("board.css", lib)).then(textOf)]);
			const fonts = (theme.match(/@font-face\s*\{[^}]*\}/g) ?? []).map((rule) => rule.replace(/url\(\s*["']?(?!data:)([^"')]+)["']?\s*\)/g, (_all, file: string) => `url("${new URL(file, lib).href}")`));
			if (!fontsSaid.has(key) && fonts.length) {
				fontsSaid.add(key);
				const style = document.createElement("style");
				style.dataset.cardFonts = lib;
				style.textContent = fonts.join("\n");
				document.head.append(style);
			}
			const css = (theme.replace(/@font-face\s*\{[^}]*\}/g, "") + "\n" + board.replace(/@import[^;]*;/g, ""))
				.replace(/html:not\(\[data-theme="light"\]\)/g, ':host(:not([data-theme="light"]))')
				.replace(/(^|[\s,}])\[data-theme="dark"\]/g, '$1:host([data-theme="dark"])')
				.replace(/:root\b/g, ":host")
				.replace(/html:has\(> body\.board\)/g, ":host")
				.replace(/html\[data-decks-focus\]\s*/g, ":host([data-decks-focus]) ")
				.replace(/body\.board/g, ".card-body")
				.replace(/(^|[\s,}])html,\s*body\s*\{/g, "$1.card-body {")
				// The card is as wide as its box, and as tall as the box at least: board.css sizes a board's body by its meta.
				/*
				 * As tall as what is in it, so the card can be measured and grow (`onHeight`); the paper is the
				 * host's, so a card shorter than its box still fills it.
				 */
				+ "\n.card-body { width: 100%; min-height: 0; height: auto; overflow: hidden; display: flow-root }\n:host { display: block; contain: strict; overflow: hidden; background: var(--b-bg) }"
				// A card is as tall as its content (`withContentHeights`) unless its height is the person's: then what does not fit scrolls.
				+ "\n:host([data-fixed-height]) { overflow-y: auto }";
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(css);
			cardSheets.add(sheet);
			return sheet;
		} catch {
			// Asked for again by the next card: a pass run out or a restart is not the end of the card's look.
			sheets.delete(key);
			return undefined;
		}
	})();
	sheets.set(key, made);
	return made;
}

/** The root, dressed as a document for a script written for a board. */
function asDocument(root: ShadowRoot, body: HTMLElement): Document {
	return new Proxy(document, {
		get(target, key) {
			if (key === "body" || key === "documentElement" || key === "head") return body;
			if (key === "readyState") return "complete";
			if (key === "querySelector" || key === "querySelectorAll" || key === "getElementById") return (root as unknown as Record<string, (...a: unknown[]) => unknown>)[key]!.bind(root);
			if (key === "getElementsByClassName" || key === "getElementsByTagName") return (body as unknown as Record<string, (...a: unknown[]) => unknown>)[key]!.bind(body);
			// A card is whole when its script runs: what waits for the page to load runs at once.
			if (key === "addEventListener")
				return (type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) => {
					if (type === "DOMContentLoaded" || type === "readystatechange") return void queueMicrotask(() => (typeof listener === "function" ? listener.call(root, new Event(type)) : listener.handleEvent(new Event(type))));
					root.addEventListener(type, listener, options);
				};
			if (key === "removeEventListener") return root.removeEventListener.bind(root);
			if (key === "activeElement") return root.activeElement;
			const value = Reflect.get(target, key, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/*
 * What `board.js` draws on a board, drawn in a card: `[data-md]` as markdown, maths in it and in a
 * `.doc`, `[data-mermaid]` as a diagram, and code in `<pre>` coloured. From the same vendored files in
 * the deck's `lib/`, each loaded once for the page whatever number of cards asks for it.
 */
const loaded = new Map<string, Promise<unknown>>();
function once<T>(given: string, make: () => Promise<T>): Promise<T> {
	// Kept by the address without its pass: a renewed pass is the same file, not a second copy (`host.ts`).
	const key = passless(given);
	let got = loaded.get(key) as Promise<T> | undefined;
	if (!got) {
		got = make();
		loaded.set(key, got);
		// One that failed (a pass run out, the server restarting) is tried again by the next card that asks.
		got.catch(() => {
			if (loaded.get(key) === got) loaded.delete(key);
		});
	}
	return got;
}

/**
 * A card's module by the address it was first imported at: a module runs once per address, and the
 * same file on a renewed pass is a new address, so it would run a second time beside the first.
 */
const modules = new Map<string, string>();
async function importOnce<T>(address: string): Promise<T> {
	const key = passless(address);
	const first = modules.get(key) ?? address;
	const module = (await import(/* @vite-ignore */ first)) as T;
	modules.set(key, first);
	return module;
}
/** A classic script from `lib/`, put in the page once: the UMD builds set a global. */
const pageScript = (lib: string, name: string) =>
	once(`script:${lib}${name}`, () => new Promise<void>((resolve, reject) => {
		const script = document.createElement("script");
		script.src = new URL(name, lib).href;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error(`${name} did not load`));
		document.head.append(script);
	}));
const pageModule = <T>(lib: string, name: string) => once(`module:${lib}${name}`, () => import(/* @vite-ignore */ new URL(name, lib).href) as Promise<T>);
/** A stylesheet in the root, where its rules apply, and in the page, where its fonts do: a shadow root's `@font-face` is not used. */
function rootStyle(root: ShadowRoot, lib: string, name: string): void {
	const href = new URL(name, lib).href;
	void once(`style:${href}`, async () => {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = href;
		document.head.append(link);
	});
	if (root.querySelector(`link[href="${href}"]`)) return;
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = href;
	root.prepend(link);
}

function dedent(text: string): string {
	const lines = text.replace(/\t/g, "  ").split("\n");
	const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^ */)![0].length);
	const common = indents.length ? Math.min(...indents) : 0;
	return lines.map((line) => line.slice(common)).join("\n").trim();
}

async function cardMath(root: ShadowRoot, target: Element, lib: string): Promise<void> {
	if (!/\$|\\\(|\\\[/.test(target.textContent ?? "")) return;
	rootStyle(root, lib, "katex.min.css");
	await pageScript(lib, "katex.min.js");
	await pageScript(lib, "katex-auto-render.min.js");
	const render = (window as unknown as { renderMathInElement?: (el: Element, options: unknown) => void }).renderMathInElement;
	render?.(target, {
		delimiters: [
			{ left: "$$", right: "$$", display: true },
			{ left: "$", right: "$", display: false },
			{ left: "\\(", right: "\\)", display: false },
			{ left: "\\[", right: "\\]", display: true },
		],
		throwOnError: false,
	});
}

async function cardCode(target: Element, lib: string): Promise<void> {
	const blocks = [...target.querySelectorAll("pre")].map((pre) => (pre.firstElementChild?.tagName === "CODE" ? pre.firstElementChild : pre)).filter((el) => !el.classList.contains("hljs") && (el.textContent ?? "").length < 65536);
	if (!blocks.length) return;
	const module = await pageModule<{ default?: unknown }>(lib, "hljs.bundle.mjs");
	const hljs = (module.default ?? module) as { getLanguage(name: string): unknown; highlight(code: string, o: { language: string; ignoreIllegals: boolean }): { value: string }; highlightAuto(code: string): { value: string; language?: string } };
	for (const element of blocks) {
		const named = [...element.classList, ...(element.parentElement?.classList ?? [])].map((c) => /^(?:language|lang)-(.+)$/.exec(c)?.[1]).find(Boolean) ?? element.getAttribute("data-lang") ?? undefined;
		if (!named || !hljs.getLanguage(named)) continue;
		element.innerHTML = hljs.highlight(element.textContent ?? "", { language: named, ignoreIllegals: true }).value;
		element.classList.add("hljs", `language-${named}`);
	}
}

async function cardMermaid(host: HTMLElement, target: HTMLElement, lib: string, source: string): Promise<void> {
	type Mermaid = { initialize(o: unknown): void; render(id: string, text: string): Promise<{ svg: string }> };
	const mermaid = await once(`mermaid:${lib}`, async () => {
		const module = await pageModule<{ default?: Mermaid }>(lib, "mermaid.bundle.mjs");
		return (module.default ?? module) as Mermaid;
	});
	const token = (name: string, fallback: string) => getComputedStyle(host).getPropertyValue(name).trim() || fallback;
	const dark = host.dataset.theme === "dark";
	/*
	 * Mermaid sizes each box by measuring its words in the page, and the card's face is declared there
	 * only as the card arrives (`cardSheet`): measured in a fallback face and drawn in the real one, the
	 * words outran their boxes. So the face is loaded first.
	 */
	const family = getComputedStyle(target).fontFamily;
	try {
		await Promise.race([document.fonts.load(`14px ${family}`), new Promise((done) => setTimeout(done, 1500))]);
	} catch {
		/* drawn in what there is */
	}
	// Each diagram in its card's own colours: initialised again before each, as a card may be light or dark.
	mermaid.initialize({
		startOnLoad: false,
		theme: "base",
		securityLevel: "strict",
		/*
		 * Words as SVG text, not HTML: mermaid measures an HTML label in the page and then draws it in the
		 * card, where the card's own paragraph and size rules restyle it, and the words overran their boxes.
		 */
		htmlLabels: false,
		flowchart: { htmlLabels: false },
		fontFamily: family,
		themeVariables: {
			background: token("--b-bg", dark ? "#161616" : "#ffffff"),
			primaryColor: token("--b-accent-soft", dark ? "#1e2a52" : "#d7e2fc"),
			primaryBorderColor: token("--b-accent", "#3b5cf6"),
			primaryTextColor: token("--b-fg", dark ? "#fafafa" : "#161616"),
			lineColor: token("--b-border-strong", dark ? "#666" : "#999"),
			textColor: token("--b-fg", dark ? "#fafafa" : "#161616"),
			tertiaryColor: token("--b-bg-layer", dark ? "#242424" : "#f2f2f2"),
			tertiaryTextColor: token("--b-muted", dark ? "#aeaeae" : "#5c5c5c"),
			edgeLabelBackground: token("--b-bg", dark ? "#161616" : "#ffffff"),
			fontSize: "14px",
		},
	});
	const { svg } = await mermaid.render(`card-mermaid-${Math.random().toString(36).slice(2, 10)}`, dedent(source));
	target.innerHTML = svg;
	const drawn = target.querySelector("svg");
	if (drawn) {
		drawn.removeAttribute("width");
		drawn.removeAttribute("height");
		drawn.style.maxWidth = "100%";
		drawn.style.maxHeight = "100%";
		drawn.setAttribute("preserveAspectRatio", "xMidYMid meet");
	}
}

/** Draw a card's markdown, maths, diagrams and code, as `board.js` draws a board's. Never throws: a part that fails says so in place. */
async function drawParts(host: HTMLElement, root: ShadowRoot, body: HTMLElement, lib: string): Promise<void> {
	const work: Promise<unknown>[] = [];
	for (const element of body.querySelectorAll<HTMLElement>("[data-md], [data-mermaid]")) {
		const source = element.textContent ?? "";
		const diagram = element.dataset.mermaid !== undefined;
		work.push(
			(async () => {
				if (diagram) return cardMermaid(host, element, lib, source);
				await pageScript(lib, "marked.umd.js");
				const marked = (window as unknown as { marked: { parse(text: string, o: unknown): string } }).marked;
				element.innerHTML = marked.parse(dedent(source.replace(/^---\n[\s\S]*?\n---\n/, "")), { gfm: true, breaks: false });
				await cardMath(root, element, lib);
				await cardCode(element, lib);
			})().catch((error) => {
				if (diagram) element.textContent = `mermaid: ${error instanceof Error ? error.message : String(error)}`;
				console.warn(`card ${diagram ? "mermaid" : "markdown"}:`, error);
			}),
		);
	}
	for (const doc of body.querySelectorAll(".doc")) work.push(cardMath(root, doc, lib).catch((error) => console.warn("card maths:", error)));
	await Promise.allSettled(work);
	await cardCode(body, lib).catch((error) => console.warn("card code:", error));
}

/**
 * The deck's own libraries, beside the boards' (`assets/importmap.json`, `{ "imports": { "name": "address" } }`):
 * added to the page's import map once, before the first card's script that could name one. An address
 * is taken from the file's own folder when it is relative. A name the page already maps keeps its
 * first address, as import maps do, so a deck cannot swap the boards' d3.
 */
function deckImports(cardUrl: string): Promise<void> {
	const at = new URL("../../assets/importmap.json", cardUrl).href;
	return once(`importmap:${at}`, async () => {
		try {
			const response = await fetch(at, { cache: "no-cache" });
			if (!response.ok) return;
			const given = (await response.json()) as { imports?: Record<string, unknown> };
			const imports: Record<string, string> = {};
			for (const [name, address] of Object.entries(given.imports ?? {})) {
				if (typeof address !== "string" || !name) continue;
				const url = new URL(address, at);
				if (url.protocol === "https:" || url.origin === location.origin) imports[name] = url.href;
			}
			if (!Object.keys(imports).length) return;
			const script = document.createElement("script");
			script.type = "importmap";
			script.dataset.cardImports = at;
			script.textContent = JSON.stringify({ imports });
			document.head.append(script);
		} catch (error) {
			console.warn(`card libraries ${at}:`, error);
		}
	});
}

const registryPerRoot = (() => {
	try {
		const Registry = (globalThis as { CustomElementRegistry?: new () => CustomElementRegistry }).CustomElementRegistry;
		return !!Registry && !!new Registry();
	} catch {
		return false;
	}
})();

/**
 * Put a card into `host`: its own closed root, board.css adopted, its HTML (cleaned first when it is
 * a friend's), then each script it runs, called with the card. Answers at once; the scripts start as
 * they arrive.
 */
export function mountCard(host: HTMLElement, source: CardSource): MountedCard {
	const registry = registryPerRoot ? new (globalThis as unknown as { CustomElementRegistry: new () => CustomElementRegistry }).CustomElementRegistry() : undefined;
	const root = host.attachShadow({ mode: "closed", ...(registry ? { customElementRegistry: registry } : {}) } as ShadowRootInit);
	host.dataset.theme = source.theme;
	// A card is `cards/<name>/index.html`: its canvas's `lib/` is two folders up.
	const lib = new URL("../../lib/", source.url).href;
	const sheetReady = cardSheet(lib).then((sheet) => {
		if (sheet) root.adoptedStyleSheets = [sheet, ...root.adoptedStyleSheets];
	});

	// Parsed where nothing runs: a template's content is inert, scripts and all.
	const template = document.createElement("template");
	template.innerHTML = source.html;
	const fragment = template.content;
	const scripts: Array<{ src?: string; n?: number }> = [];
	let n = 0;
	for (const script of [...fragment.querySelectorAll("script")]) {
		if (!runs(script)) continue;
		const src = script.getAttribute("src");
		if (src) scripts.push({ src: new URL(src, source.url).href });
		else scripts.push({ n: n++ });
		script.remove();
	}
	/*
	 * A friend's card keeps its own stylesheets, cleaned: each is fetched, its imports and outside
	 * addresses taken out, and put in as a `<style>`, since a linked sheet's own `url()`s cannot be.
	 */
	addressesFromCard(fragment, source.url);
	const sheetsToClean: Array<{ href: string; into: HTMLStyleElement }> = [];
	if (!source.trusted) {
		for (const link of [...fragment.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')]) {
			const href = link.getAttribute("href") ?? "";
			if (!inDeck(href, source.url)) continue;
			const into = document.createElement("style");
			link.replaceWith(into);
			sheetsToClean.push({ href: new URL(href, source.url).href, into });
		}
		clean(fragment, source.url);
	}
	for (const { href, into } of sheetsToClean)
		void fetch(href)
			.then((response) => (response.ok ? response.text() : ""))
			.then((css) => (into.textContent = cleanCss(cssFromCard(css, href), href)))
			.catch(() => undefined);
	const body = document.createElement("div");
	// Also `board`, so a board's own `.board .doc` rules match a card made from it.
	body.className = "card-body board";
	body.append(fragment);
	root.append(body);

	const controller = new AbortController();
	const listeners = { theme: new Set<() => void>(), size: new Set<() => void>() };
	const store = {
		getItem: (key: string) => localStorage.getItem(`decks.card:${source.path}:${key}`),
		setItem: (key: string, value: string) => localStorage.setItem(`decks.card:${source.path}:${key}`, value),
		removeItem: (key: string) => localStorage.removeItem(`decks.card:${source.path}:${key}`),
	};
	const context: CardContext = {
		root,
		document: asDocument(root, body),
		signal: controller.signal,
		url: source.url,
		// On the canvas's pass now: a card reads a file long after it was loaded.
		file: (name: string) => freshAddress(new URL(name, source.url).href),
		theme: source.theme,
		size: { ...source.size },
		elements: registry ?? customElements,
		store,
		on: (what, listener) => void listeners[what].add(listener),
		// A friend's card runs no script, so it never makes a call; the deck's own make them as themselves.
		decks: cardDecks(source.trusted ? source.call : undefined),
		path: source.path,
	};
	const cleanups: Array<() => void> = [];
	// Its markdown, maths, diagrams and code drawn, after board.css so a diagram takes the card's colours.
	const partsDrawn = sheetReady.then(() => drawParts(host, root, body, lib));
	if (source.trusted && scripts.length) {
		const base = source.url.replace(/[?#].*$/, "");
		void (async () => {
			// After board.css and the parts it draws, so a script that measures its card measures it as it shows.
			await sheetReady;
			await partsDrawn;
			await deckImports(source.url);
			for (const script of scripts) {
				if (controller.signal.aborted) return;
				const address = script.src ?? `${base}.m${script.n}.js`;
				try {
					const module = await importOnce<{ default?: (card: CardContext) => CardCleanup | Promise<CardCleanup> }>(address);
					if (controller.signal.aborted || typeof module.default !== "function") continue;
					const done = await module.default(context);
					if (typeof done === "function") {
						if (controller.signal.aborted) done();
						else cleanups.push(done);
					}
				} catch (error) {
					console.error(`card ${source.path}: ${address}`, error);
				}
			}
		})();
	}
	const heightListeners = new Set<(h: number) => void>();
	let lastHeight = 0;
	const sizes = new ResizeObserver(() => {
		const h = Math.ceil(body.offsetHeight);
		if (h === lastHeight || h === 0) return;
		lastHeight = h;
		for (const listener of heightListeners) listener(h);
	});
	sizes.observe(body);
	return {
		root,
		reading: () => readingOfCard(body),
		onHeight(listener) {
			heightListeners.add(listener);
			if (lastHeight) listener(lastHeight);
		},
		setTheme(theme) {
			if (context.theme === theme) return;
			context.theme = theme;
			host.dataset.theme = theme;
			for (const listener of listeners.theme) listener();
		},
		setSize(size) {
			if (context.size.w === size.w && context.size.h === size.h) return;
			context.size = { ...size };
			for (const listener of listeners.size) listener();
		},
		dispose() {
			sizes.disconnect();
			heightListeners.clear();
			controller.abort();
			for (const done of cleanups.splice(0)) {
				try {
					done();
				} catch (error) {
					console.error(`card ${source.path}`, error);
				}
			}
			root.replaceChildren();
		},
	};
}

/** Whether something in a card can scroll the way a wheel goes, from the element under it out to the card. */
export function scrollsInside(path: EventTarget[], host: HTMLElement, dx: number, dy: number): boolean {
	for (const target of path) {
		if (target === host) return false;
		if (!(target instanceof Element)) continue;
		const style = getComputedStyle(target);
		const y = /(auto|scroll)/.test(style.overflowY) && target.scrollHeight > target.clientHeight + 1;
		const x = /(auto|scroll)/.test(style.overflowX) && target.scrollWidth > target.clientWidth + 1;
		if (y && dy !== 0 && (dy < 0 ? target.scrollTop > 0 : target.scrollTop + target.clientHeight < target.scrollHeight - 1)) return true;
		if (x && dx !== 0 && (dx < 0 ? target.scrollLeft > 0 : target.scrollLeft + target.clientWidth < target.scrollWidth - 1)) return true;
	}
	return false;
}

/** What a press inside a card is: a control of the card's own, which a finger uses rather than pans across. */
export const INTERACTIVE = "a[href], button, input, select, textarea, label, summary, [contenteditable=''], [contenteditable='true'], [role='button'], [role='tab'], [data-interactive]";
