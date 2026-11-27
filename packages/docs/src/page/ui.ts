import { getLocale, m } from "@decks/i18n";

/**
 * What every part of the document page draws with: its icons, a way to make an element, and the
 * small words (a file's name, a time, a clipped snippet, who made a change) more than one panel shows.
 */

const ICON: Record<string, string> = {
	bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
	italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
	strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
	underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>',
	code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
	mark: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
	link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
	math: '<path d="M18 7V4H6l6 8-6 8h12v-3"/>',
	ul: '<line x1="9" x2="21" y1="6" y2="6"/><line x1="9" x2="21" y1="12" y2="12"/><line x1="9" x2="21" y1="18" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
	ol: '<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
	task: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
	quote: '<path d="M17 6H3"/><path d="M21 12H8"/><path d="M21 18H8"/><path d="M3 12v6"/>',
	codeblock: '<path d="m10 9-3 3 3 3"/><path d="m14 15 3-3-3-3"/><rect x="3" y="3" width="18" height="18" rx="2"/>',
	hr: '<path d="M5 12h14"/>',
	table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M12 3v18"/>',
	undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
	redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
	display: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M16 8.9V7H8l4 5-4 5h8v-1.9"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
	source: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>',
	changes: '<path d="M12 20h9"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
	restore: '<path d="M3 12a9 9 0 1 0 9-9 9.7 9.7 0 0 0-6.7 2.7L3 8"/><path d="M3 3v5h5"/>',
	chevron: '<path d="m6 9 6 6 6-6"/>',
	pdf: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M14 3v18"/>',
	refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.5 2.8L21 8"/><path d="M21 3v5h-5"/>',
	external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
	alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
	branch: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
	pull: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
	push: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
	comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
	rowabove: '<rect x="3" y="12" width="18" height="9" rx="1"/><path d="M12 3v6"/><path d="M9 6h6"/>',
	rowbelow: '<rect x="3" y="3" width="18" height="9" rx="1"/><path d="M12 15v6"/><path d="M9 18h6"/>',
	colleft: '<rect x="12" y="3" width="9" height="18" rx="1"/><path d="M3 12h6"/><path d="M6 9v6"/>',
	colright: '<rect x="3" y="3" width="9" height="18" rx="1"/><path d="M15 12h6"/><path d="M18 9v6"/>',
	rowdelete: '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="m9 10 6 4"/><path d="m15 10-6 4"/>',
	coldelete: '<rect x="8" y="3" width="8" height="18" rx="1"/><path d="m10 9 4 6"/><path d="m14 9-4 6"/>',
	alignleft: '<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>',
	aligncenter: '<path d="M21 6H3"/><path d="M17 12H7"/><path d="M19 18H5"/>',
	alignright: '<path d="M21 6H3"/><path d="M21 12H9"/><path d="M21 18H7"/>',
	justify: '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>',
	textcolour: '<path d="M4 20h16" stroke-width="3"/><path d="m6 16 6-12 6 12"/><path d="M8 12h8"/>',
	clear: '<path d="M4 7V4h16v3"/><path d="M5 20h6"/><path d="M13 4 8 20"/><path d="m15 15 5 5"/><path d="m20 15-5 5"/>',
	minus: '<path d="M5 12h14"/>',
	indent: '<path d="M21 6H11"/><path d="M21 12H11"/><path d="M21 18H11"/><path d="m3 8 4 4-4 4"/>',
	outdent: '<path d="M21 6H11"/><path d="M21 12H11"/><path d="M21 18H11"/><path d="m7 8-4 4 4 4"/>',
	plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
	cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
	cloudoff: '<path d="m2 2 20 20"/><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2"/><path d="M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10.2 5.15"/>',
};

export const svg = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name] ?? ""}</svg>`;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
	if (text !== undefined) node.textContent = text;
	return node;
}

/** A square button showing only an icon, its label read out and shown on hover. */
export function iconButton(icon: string, label: string, cls = "dp-ib"): HTMLButtonElement {
	const b = el("button", { type: "button", class: cls, title: label, "aria-label": label, "aria-pressed": "false" });
	b.innerHTML = svg(icon);
	return b;
}

export const base = (path: string) => path.split(/[\\/]/).pop() ?? path;
export const dir = (path: string) => path.replace(/[\\/][^\\/]*$/, "");
const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const keyName = (k: string) => (mac ? k.replace("Mod+", "⌘").replace("Shift+", "⇧") : k.replace("Mod+", "Ctrl+"));

export const when = (at: number) => new Date(at).toLocaleString(getLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
export const clip = (text: string, n = 70) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** Who made a change, as the page names them: a program with no name of its own is "another program". */
export const whoOf = (by: string) => (by === "outside" ? m.docs_another_program() : by);
export const initial = (by: string) => (by === "outside" ? "?" : by.trim().charAt(0).toUpperCase() || "?");
