/**
 * A board's page as it stands, written out as markup a fresh load shows the same way (`snapshot`
 * adaptor, `boards/snapshot.ts` on the server).
 *
 * The markup after every script has run is most of it; what a fresh load would lose is written in:
 * what was typed into fields, which boxes were scrolled and how far, and each canvas's pixels, as a
 * picture in its place. Scripts are taken out, so a chart drawn by one is not drawn a second time.
 * Nothing here reads a computed style, which is what makes it a few milliseconds.
 *
 * Elements are told apart by tag, not by `instanceof`: they belong to the board's own window, whose
 * `HTMLInputElement` is not this one's, so an `instanceof` here is false for every one of them.
 * And styles a script made without markup — a sheet built in script and adopted, or rules inserted
 * into an empty `<style>`, which is how KaTeX and some chart libraries style themselves — are
 * written out as `<style>`, since the markup alone does not carry them.
 */
export function snapshotOf(doc: Document): string {
	const live = doc.documentElement;
	const copy = live.cloneNode(true) as HTMLElement;
	const from = live.querySelectorAll("*");
	const to = copy.querySelectorAll("*");
	const canvases: Array<[HTMLCanvasElement, Element]> = [];
	const styles: string[] = [];
	for (let i = 0; i < from.length; i++) {
		const a = from[i]!;
		const b = to[i];
		if (!b) break;
		const tag = a.tagName;
		if (tag === "INPUT") {
			const input = a as HTMLInputElement;
			if (input.type === "checkbox" || input.type === "radio") b.toggleAttribute("checked", input.checked);
			else b.setAttribute("value", input.value);
		} else if (tag === "TEXTAREA") b.textContent = (a as HTMLTextAreaElement).value;
		else if (tag === "SELECT") {
			Array.from((a as HTMLSelectElement).options).forEach((option, k) => (b as HTMLSelectElement).options[k]?.toggleAttribute("selected", option.selected));
		} else if (tag === "CANVAS") canvases.push([a as HTMLCanvasElement, b]);
		else if (tag === "STYLE" && !(a.textContent ?? "").trim()) {
			// Rules put in by script: the element is empty in the markup.
			const rules = rulesOf((a as HTMLStyleElement).sheet);
			if (rules) b.textContent = rules;
		}
		if (a.scrollTop || a.scrollLeft) b.setAttribute("data-decks-scroll", `${a.scrollLeft},${a.scrollTop}`);
	}
	for (const sheet of Array.from(doc.adoptedStyleSheets ?? [])) {
		const rules = rulesOf(sheet);
		if (rules) styles.push(rules);
	}
	if (styles.length > 0) {
		const style = doc.createElement("style");
		style.textContent = styles.join("\n");
		(copy.querySelector("head") ?? copy).appendChild(style);
	}
	for (const [a, b] of canvases) {
		let pixels: string;
		try {
			pixels = a.toDataURL();
		} catch {
			continue; // A canvas holding another site's picture cannot be read; it stays empty.
		}
		const img = doc.createElement("img");
		for (const attribute of Array.from(b.attributes)) img.setAttribute(attribute.name, attribute.value);
		const box = a.getBoundingClientRect();
		img.src = pixels;
		img.style.width = `${box.width}px`;
		img.style.height = `${box.height}px`;
		b.replaceWith(img);
	}
	copy.querySelectorAll("script").forEach((script) => script.remove());
	/*
	 * Links written out absolute to this page's own address, as a script adding a stylesheet does
	 * (`board.js` loads KaTeX's that way), are made relative to the site: the server draws the page at
	 * its own address, which is not the one the browser used, and a link to the browser's would be
	 * another site to it.
	 */
	const own = doc.location.origin;
	for (const element of Array.from(copy.querySelectorAll("[href], [src]"))) {
		for (const name of ["href", "src"]) {
			const value = element.getAttribute(name);
			if (value?.startsWith(`${own}/`)) element.setAttribute(name, value.slice(own.length));
		}
	}
	return `<!doctype html>\n${copy.outerHTML}`;
}

/** A sheet's rules as text, or nothing when it cannot be read (another site's sheet). */
function rulesOf(sheet: CSSStyleSheet | null | undefined): string {
	if (!sheet) return "";
	try {
		return Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
	} catch {
		return "";
	}
}
