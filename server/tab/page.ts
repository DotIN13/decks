// The scripts that run inside the shared tab's page, as text for
// Runtime.evaluate: the server has no DOM. Rules 5, 6 and 7 of the README.

/** What every script shares: roles, names, what is shown. */
const COMMON = String.raw`
const ROLE_OF = (el) => {
	const given = el.getAttribute("role");
	if (given) return given;
	const tag = el.tagName.toLowerCase();
	if (tag === "a" && el.hasAttribute("href")) return "link";
	if (tag === "button") return "button";
	if (tag === "select") return "combobox";
	if (tag === "textarea") return "textbox";
	if (/^h[1-6]$/.test(tag)) return "heading";
	if (el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable)) return "textbox";
	if (tag !== "input") return "";
	const type = (el.getAttribute("type") || "text").toLowerCase();
	if (type === "hidden") return "";
	if (["button", "submit", "reset", "image"].includes(type)) return "button";
	if (type === "checkbox" || type === "radio") return type;
	return "textbox";
};
const TEXT = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 100);
const NAME_OF = (el) => {
	const doc = el.ownerDocument;
	const label = el.getAttribute("aria-label");
	if (label) return TEXT(label);
	const by = el.getAttribute("aria-labelledby");
	if (by) return TEXT(by.split(/\s+/).map((id) => (doc.getElementById(id) || {}).textContent || "").join(" "));
	if (el.id) {
		const forIt = doc.querySelector('label[for="' + CSS.escape(el.id) + '"]');
		if (forIt) return TEXT(forIt.textContent);
	}
	const wrap = el.closest("label");
	if (wrap && wrap !== el) return TEXT(wrap.textContent);
	const tag = el.tagName.toLowerCase();
	if (tag === "input" && ["button", "submit", "reset"].includes(el.type)) return TEXT(el.value);
	return TEXT(el.getAttribute("placeholder") || el.getAttribute("alt") || el.getAttribute("title") || el.innerText || el.textContent);
};
const SHOWN = (el) => {
	const box = el.getBoundingClientRect();
	const style = el.ownerDocument.defaultView.getComputedStyle(el);
	if (style.visibility === "hidden" || style.display === "none") return false;
	return box.width > 0 || box.height > 0 || el.type === "checkbox" || el.type === "radio";
};
`;

/** The page as lines, each control with a reference; kept on the window. */
export const READ = String.raw`(() => {
${COMMON}
	const refs = [];
	const lines = [];
	for (const el of document.body ? document.body.querySelectorAll("*") : []) {
		const role = ROLE_OF(el);
		if (!role || !SHOWN(el)) continue;
		refs.push(el);
		let line = "- " + role + ' "' + NAME_OF(el) + '" [ref=e' + refs.length + "]";
		if (role === "heading") line += " [level=" + (el.tagName[1] || el.getAttribute("aria-level") || "2") + "]";
		if (role === "textbox") line += ': "' + TEXT(el.isContentEditable ? el.textContent : el.value) + '"';
		if (role === "combobox" && el.tagName === "SELECT") line += ': "' + TEXT((el.selectedOptions[0] || {}).textContent) + '"';
		if ((role === "checkbox" || role === "radio") && el.checked) line += " [checked]";
		if (el.disabled) line += " [disabled]";
		lines.push(line);
	}
	window.__decksRefs = refs;
	return { url: location.href, title: document.title, snapshot: lines.join("\n") };
})()`;

const ACT = String.raw`(args) => {
${COMMON}
	const ROLES = {
		fill: ["textbox", "combobox", "searchbox"],
		select: ["combobox", "listbox"],
		click: ["button", "link", "checkbox", "radio", "tab", "menuitem", "switch", "option"],
	}[args.mode];
	const say = (error) => ({ error });
	const find = () => {
		const t = args.target;
		if (t && typeof t === "object" && "ref" in t) {
			const n = Number(String(t.ref).replace(/^@?e/, ""));
			const el = (window.__decksRefs || [])[n - 1];
			if (!el || !el.isConnected) return say("Nothing on this page has the reference " + t.ref + ". Read it again with tab.read: the page may have redrawn.");
			return { el };
		}
		const name = typeof t === "string" ? t : t && t.name;
		const nth = t && typeof t === "object" ? t.nth : undefined;
		if (!name || !String(name).trim()) return say("A target needs a name, or a { ref } from tab.read.");
		const all = [...document.querySelectorAll("*")].filter((el) => SHOWN(el));
		const wanted = String(name).toLowerCase();
		const typed = all.filter((el) => ROLES.includes(ROLE_OF(el)));
		const own = (el) => TEXT(el.innerText).toLowerCase();
		const rungs = [
			() => typed.filter((el) => NAME_OF(el).toLowerCase() === wanted),
			() => typed.filter((el) => NAME_OF(el).toLowerCase().includes(wanted)),
			() => (args.mode === "click" ? all.filter((el) => own(el) === wanted && ![...el.children].some((c) => own(c) === wanted)) : []),
		];
		for (const rung of rungs) {
			const hits = rung();
			if (!hits.length) continue;
			if (nth !== undefined) {
				if (!Number.isInteger(nth) || nth < 1 || nth > hits.length) return say('"' + name + '" matches ' + hits.length + " on this page, so nth: " + nth + " is out of range; nth: 1 is the first.");
				return { el: hits[nth - 1] };
			}
			if (hits.length > 1) return say('"' + name + '" matches ' + hits.length + ' elements on this page, so I did not guess. Take one by position with { name: "' + name + '", nth: 1 }, or read the page (tab.read) and pass a { ref }.');
			return { el: hits[0] };
		}
		return say('Nothing on the page is called "' + name + '". Read the page (tab.read) to see the names it uses.');
	};
	const reach = (el) => {
		el.scrollIntoView({ block: "center", inline: "center" });
		const box = el.getBoundingClientRect();
		for (let up = el; up; up = up.parentElement) {
			const r = up.getBoundingClientRect();
			const s = getComputedStyle(up);
			if (r.width <= 2 || r.height <= 2 || s.clip === "rect(0px, 0px, 0px, 0px)" || s.clipPath === "inset(100%)") return { kind: "hidden" };
		}
		const x = box.left + box.width / 2, y = box.top + box.height / 2;
		const top = document.elementFromPoint(x, y);
		if (!top) return { kind: "gone" };
		if (top === el || el.contains(top) || top.contains(el)) return { kind: "ready", x, y };
		return { kind: "covered", by: "<" + top.tagName.toLowerCase() + (top.id ? "#" + top.id : "") + ">" };
	};
	const found = find();
	if (found.error) return found;
	const el = found.el;
	const label = NAME_OF(el) || el.tagName.toLowerCase();
	if (args.mode === "fill") {
		el.focus();
		if (el.isContentEditable) el.textContent = args.text;
		else {
			const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
			Object.getOwnPropertyDescriptor(proto, "value").set.call(el, args.text);
		}
		el.dispatchEvent(new Event("input", { bubbles: true }));
		el.dispatchEvent(new Event("change", { bubbles: true }));
		return { label };
	}
	if (args.mode === "select") {
		if (el.tagName !== "SELECT") return say(label + " is not a list to choose from.");
		const want = String(args.option).toLowerCase();
		const option = [...el.options].find((o) => TEXT(o.textContent).toLowerCase() === want || o.value.toLowerCase() === want);
		if (!option) return say(label + " has no option " + args.option + ".");
		el.value = option.value;
		el.dispatchEvent(new Event("input", { bubbles: true }));
		el.dispatchEvent(new Event("change", { bubbles: true }));
		return { label };
	}
	const where = reach(el);
	if (where.kind === "covered") return say(label + " is on the page, but " + where.by + " is over it. Close or scroll past that first.");
	if (where.kind === "gone") return say(label + " is in the page, but nothing is painted where it sits.");
	if (where.kind === "hidden") {
		el.click();
		return { label, hidden: true };
	}
	return { label, point: { x: where.x, y: where.y } };
}`;

export type Mode = "fill" | "select" | "click";
export type Acted = { error?: string; label?: string; hidden?: boolean; point?: { x: number; y: number } };

/** The script that finds a target and acts on it, with its arguments in. */
export function actScript(args: { mode: Mode; target: unknown; text?: string; option?: string }): string {
	return `(${ACT})(${JSON.stringify(args)})`;
}

/** The address and title of the page. */
export const WHERE = "({ url: location.href, title: document.title, ready: document.readyState })";
