/**
 * The two rules, and nothing else.
 *
 * A browser agent is fast because it decides and acts without asking. Two of the things it
 * decides are not its to decide: whether something gets sent, and what words go into a
 * field. This module is the whole of that judgement, kept apart from the socket so it can
 * be read and tested without a browser.
 *
 * It is deliberately narrow. A rule that guessed would either stop the agent on every
 * second click or miss the one that mattered, so `classify` answers only what the command
 * itself says, and `judgeClick` answers only what the page said about the element under
 * the pointer. Everything else is `pass`.
 */

/** A DevTools Protocol message, as it travels: a command with an `id`, or an event with a `method`. */
export interface CdpMessage {
	id?: number;
	sessionId?: string;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: { code?: number; message: string };
}

/** What the page said about the element under a click. */
export interface ClickTarget {
	tag: string;
	/** Its visible name: text, value, or label. Empty when the element has none. */
	name: string;
	/** Pressing it submits a form. */
	submits: boolean;
	inForm: boolean;
	href?: string;
}

/** What to do with one command. */
export type Decision =
	| { kind: "pass" }
	| { kind: "click"; x: number; y: number }
	| { kind: "text"; text: string }
	| { kind: "allow"; action: string };

/**
 * Words that name a consequence when they are on the control being pressed.
 *
 * The structural test above catches anything inside a form. This catches the rest, because
 * a page can put its send button in no form at all, and "Send" is what it will be called.
 */
const SENDING =
	/\b(send|submit|post|buy|pay|purchase|order|confirm|delete|remove|publish|share|sign|accept|agree|apply|save|book|reserve|checkout|subscribe|unsubscribe|transfer|withdraw|invite)\b/i;

/** Keys that mean "go" rather than "type". Enter submits the form the caret is in. */
const ENTER = new Set(["Enter", "NumpadEnter"]);

/**
 * What one command asks for.
 *
 * The three cases are the whole gate. A click is not decided here, because whether it sends
 * anything is a question for the page: `judgeClick` answers that once the element under the
 * pointer has been read.
 */
export function classify(message: CdpMessage): Decision {
	const params = message.params ?? {};
	switch (message.method) {
		case "Input.insertText": {
			const text = typeof params.text === "string" ? params.text : "";
			return text ? { kind: "text", text } : { kind: "pass" };
		}
		case "Input.dispatchKeyEvent": {
			const key = typeof params.key === "string" ? params.key : "";
			const text = typeof params.text === "string" ? params.text : "";
			/*
			 * Enter is a submit, not a keystroke to be typed. It arrives twice — a keyDown
			 * named Enter and a char carrying "\r" — and both are the same decision.
			 */
			if (ENTER.has(key) || text === "\r" || text === "\n") return { kind: "allow", action: "press Enter" };
			// A keyDown that carries text is typing with extra steps; a modifier or an arrow
			// carries none and is navigation, which the agent does on its own.
			return text.trim() ? { kind: "text", text } : { kind: "pass" };
		}
		case "Input.dispatchMouseEvent": {
			// The press, not the release: holding the press leaves the page untouched, and a
			// refused press means the release that would have followed never comes.
			if (params.type !== "mousePressed") return { kind: "pass" };
			const button = typeof params.button === "string" ? params.button : "left";
			if (button !== "left") return { kind: "pass" };
			const x = typeof params.x === "number" ? params.x : Number.NaN;
			const y = typeof params.y === "number" ? params.y : Number.NaN;
			return Number.isFinite(x) && Number.isFinite(y) ? { kind: "click", x, y } : { kind: "pass" };
		}
		default:
			return { kind: "pass" };
	}
}

/**
 * What a click on this element means.
 *
 * Two ways in. A control that submits a form is the structural one and does not depend on
 * what anybody called it. A control whose name is a consequence — Send, Buy, Delete — is
 * the second, and it is what catches a button in no form at all. A link is neither: the
 * agent follows links by itself, which is most of what it does.
 */
export function judgeClick(target: ClickTarget | undefined, at: { x: number; y: number }): Decision {
	if (!target) return { kind: "pass" };
	if (target.tag === "A" && target.href) return { kind: "pass" };
	const name = target.name.trim();
	const where = name ? ` "${name}"` : "";
	if (target.submits) return { kind: "allow", action: `click${where} — it submits the form` };
	if (name && SENDING.test(name)) return { kind: "allow", action: `click${where}` };
	return { kind: "pass" };
}

/**
 * The question the page is asked about a click, as one expression.
 *
 * It walks up from the point: a `<span>` inside a button is the button, and a button inside
 * a form is a submit unless it says otherwise. `elementFromPoint` reads the same coordinate
 * space the mouse event carries, which is why this is asked with the click's own numbers
 * rather than with a node handle.
 */
export function clickProbe(x: number, y: number): string {
	return `(() => {
	const at = document.elementFromPoint(${JSON.stringify(x)}, ${JSON.stringify(y)});
	if (!at) return null;
	const press = at.closest('button, input, [role="button"], a, summary, label') || at;
	const form = press.form || press.closest('form');
	const name = (press.innerText || press.value || press.getAttribute('aria-label') || press.title || '').trim().slice(0, 80);
	const type = (press.getAttribute('type') || '').toLowerCase();
	const submits = (press.tagName === 'BUTTON' && type !== 'button' && !!form) || (press.tagName === 'INPUT' && (type === 'submit' || type === 'image'));
	return { tag: press.tagName, name, submits, inForm: !!form, href: press.href || '' };
})()`;
}

/**
 * The question the page is asked about the field the agent is typing into.
 *
 * A held command has to be answerable, and "type into a field" is not: the person being
 * asked needs to know which one. The focused element's label, placeholder or name is the
 * same thing a person would read off the screen.
 */
export function fieldProbe(): string {
	return `(() => {
	const at = document.activeElement;
	if (!at || at === document.body) return '';
	const label = at.labels && at.labels[0] ? at.labels[0].innerText : '';
	const name = (label || at.getAttribute('aria-label') || at.placeholder || at.name || at.id || '').trim().slice(0, 80);
	return name ? at.tagName.toLowerCase() + ' "' + name + '"' : at.tagName.toLowerCase() + ' field';
})()`;
}

/** The page's answer to `clickProbe`, checked field by field — it comes back from a page the agent chose to visit. */export function clickTarget(value: unknown): ClickTarget | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	if (typeof raw.tag !== "string") return undefined;
	return {
		tag: raw.tag.toUpperCase(),
		name: typeof raw.name === "string" ? raw.name : "",
		submits: raw.submits === true,
		inForm: raw.inForm === true,
		...(typeof raw.href === "string" && raw.href ? { href: raw.href } : {}),
	};
}
