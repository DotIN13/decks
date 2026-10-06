/**
 * An agent's own drawing of itself, checked and made renderable before it is stored.
 *
 * An avatar is served as a file and drawn by the browser as an **image** — `<img src>`, and a CSS
 * background in places. An image is parsed on its own, with no HTML document around it, so an
 * `<svg>` with no `xmlns` is not SVG at all to the parser and the browser draws nothing. In a page
 * it would have worked, which is what makes it such a good trap: the markup looks right, the file
 * is on disk, the request answers 200, and the person sees an empty circle.
 *
 * Basil hit exactly that on 5 October 2026 and had no way to know. So the shape an agent is shown
 * is made to work rather than being required to be perfect: what can be repaired is repaired and
 * said, and only what cannot is refused.
 *
 * Repaired: a missing `xmlns`, and a missing `viewBox` when the root says how big it is.
 * Refused, with a sentence: anything whose root is not `<svg>`, anything with no size at all,
 * anything carrying script, and anything too big to be a small drawing of a face.
 */

/** An avatar is a few hundred bytes of paths. This is room for a detailed one and not for a map. */
export const AVATAR_LIMIT = 64 * 1024;

export interface CheckedAvatar {
	/** What to store: the agent's own markup, repaired if it needed it. */
	svg: string;
	/**
	 * What was repaired on the way in, as a sentence for the agent — absent when nothing was.
	 * Said rather than silently done: an agent that is never told keeps drawing the broken shape.
	 */
	changed?: string;
}

/*
 * The root tag, after anything allowed to come before it: an XML declaration and comments.
 * Read and rewritten as text rather than parsed, because the one thing being changed is an
 * attribute of the first tag, and a parser that round-trips SVG faithfully is a dependency this
 * does not need. Everything else below looks at the whole string, where being approximate is the
 * safe direction: a false positive refuses a drawing, and the agent can draw another.
 */
const ROOT = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b([^>]*)>/i;
const SCRIPT = /<script[\s>]/i;
const HANDLER = /\son[a-z]+\s*=/i;
const JAVASCRIPT = /(?:href|src)\s*=\s*["']?\s*javascript:/i;
const VIEWBOX = /\bviewBox\s*=/i;
const XMLNS = /\bxmlns\s*=/i;
const WIDTH = /\bwidth\s*=\s*["']?\s*([\d.]+)/i;
const HEIGHT = /\bheight\s*=\s*["']?\s*([\d.]+)/i;

/**
 * Check an agent's avatar and return what to store, with a note when it had to be changed.
 *
 * Throws with a sentence an agent can act on: it is read by a model, so it says what is wrong and
 * what to do, not which rule fired.
 */
export function checkAvatar(raw: string): CheckedAvatar {
	const svg = String(raw ?? "").trim();
	if (!svg) throw new Error("An avatar cannot be empty. Draw a small SVG, or set an emoji instead: avatar: { emoji: \"🫖\" }.");
	if (svg.length > AVATAR_LIMIT) {
		throw new Error(`That avatar is ${Math.round(svg.length / 1024)}KB, and an avatar is a small drawing: keep it under ${AVATAR_LIMIT / 1024}KB.`);
	}
	const root = ROOT.exec(svg);
	if (!root) throw new Error("An avatar has to be a single SVG: it must start with <svg> and that must be the element everything else is inside.");
	if (SCRIPT.test(svg)) throw new Error("An avatar cannot carry a <script>: it is drawn as an image, and a drawing of a face does not need code in it.");
	if (HANDLER.test(svg)) throw new Error("An avatar cannot carry an event handler such as onload or onclick: it is drawn as an image and nothing will ever call it.");
	if (JAVASCRIPT.test(svg)) throw new Error("An avatar cannot link to javascript:. Draw the shapes themselves.");

	const attrs = root[1] ?? "";
	const fixes: string[] = [];
	let tag = root[0];

	/*
	 * The `viewBox` first, because the repair for a missing one reads the width and height that
	 * are about to be joined by `xmlns` — and because an avatar with neither is the one case that
	 * cannot be repaired at all: nothing in the file says how big the drawing is.
	 */
	if (!VIEWBOX.test(attrs)) {
		const w = WIDTH.exec(attrs)?.[1];
		const h = HEIGHT.exec(attrs)?.[1];
		if (w && h && Number(w) > 0 && Number(h) > 0) {
			tag = tag.replace(/<svg\b/i, `<svg viewBox="0 0 ${Number(w)} ${Number(h)}"`);
			fixes.push(`a viewBox of "0 0 ${Number(w)} ${Number(h)}" was added from its width and height, so it scales to the circle it is drawn in`);
		} else {
			throw new Error('An avatar needs a viewBox, which is what lets it scale to whatever size it is drawn at: <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">…</svg>.');
		}
	}

	/*
	 * And the `xmlns`, the one that made this file exist. Added rather than refused because the
	 * markup is otherwise exactly right, and because the shape agents are shown had no xmlns in it
	 * for a month: refusing would have been correct and useless.
	 */
	if (!XMLNS.test(attrs)) {
		tag = tag.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
		fixes.push("an xmlns was added, without which the browser does not read the file as SVG at all and draws nothing");
	}

	const out = tag === root[0] ? svg : svg.replace(root[0], tag);
	return fixes.length > 0 ? { svg: out, changed: `Your avatar was stored with a change: ${fixes.join("; ")}.` } : { svg: out };
}
