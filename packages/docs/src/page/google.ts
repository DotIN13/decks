import type { DocRemoteStatus } from "../index.ts";
import type { DocsRequest } from "../gdoc/types.ts";
import { getLocale, m } from "@decks/i18n";
import type { PageContext } from "./context.ts";
import { el, svg } from "./ui.ts";

/**
 * A Google Doc: the button saying how the link stands, its popover with where the Doc lives and
 * signing in, and the styles the page sends to Google in step with the typing.
 */

export function mountGoogle(ctx: PageContext): () => void {
	const { sync, gview, options } = ctx;
	const { googleBox } = ctx.dom;
	const googleButton = el("button", { type: "button", class: "dp-btn", "aria-pressed": "false", "aria-haspopup": "dialog", title: m.docs_google_title() });
	const googleMenu = el("div", { class: "dp-gitmenu", role: "dialog", hidden: "" });
	googleBox.append(googleButton, googleMenu);
	let remoteStatus: DocRemoteStatus | undefined;
	let pasteSaid = "";

	/** Signing in to Google: a button, and for a Desktop client the box to paste the address back into. */
	function signInParts(): HTMLElement[] {
		if (!options.api) return [];
		const parts: HTMLElement[] = [];
		const signIn = el("button", { type: "button", class: "dp-btn dp-primary" }, m.docs_google_sign_in());
		signIn.style.justifyContent = "center";
		signIn.onclick = () => window.open(`${options.api}/google/signin?origin=${encodeURIComponent(location.origin)}`, "_blank", "noopener");
		parts.push(signIn);
		if (remoteStatus?.paste !== false) {
			const form = el("form", { class: "g-paste" });
			const input = el("input", { type: "url", placeholder: m.docs_google_paste(), "aria-label": m.docs_google_paste_label() });
			const done = el("button", { type: "submit", class: "dp-btn dp-outline" }, m.docs_done());
			form.append(input, done);
			form.onsubmit = (event) => {
				event.preventDefault();
				void fetch(`${options.api}/google/code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: input.value }) })
					.then((r) => r.json() as Promise<{ ok: boolean; email?: string; message?: string }>)
					.then((answer) => {
						pasteSaid = answer.ok ? m.docs_google_signed_in({ email: answer.email ?? "" }) : (answer.message ?? m.docs_google_failed());
						drawGoogle();
						if (ctx.view === "comments") ctx.hooks.drawComments();
					});
			};
			parts.push(form);
		}
		if (pasteSaid) parts.push(el("div", { class: "g-note" }, pasteSaid));
		return parts;
	}

	function drawGoogle(): void {
		const remote = sync.remote;
		googleBox.hidden = !remote;
		if (!remote) return;
		const state = remoteStatus?.state ?? "syncing";
		const words = { synced: "Google Docs", syncing: m.docs_google_syncing(), signin: m.docs_google_signin(), error: m.docs_google_error() }[state];
		googleButton.innerHTML = `${svg(state === "signin" || state === "error" ? "cloudoff" : "cloud")}<span>${words}</span><span class="dp-dot" data-state="${state}"></span>`;
		if (googleMenu.hidden) return;
		const head = el("div", { class: "g-where" });
		head.innerHTML = svg("cloud");
		head.append(remote.title);
		const open = el("a", { class: "g-open", href: remote.url, target: "_blank", rel: "noopener" }, m.docs_google_open());
		open.insertAdjacentHTML("beforeend", svg("external"));
		const when = remoteStatus?.at ? new Date(remoteStatus.at).toLocaleTimeString(getLocale(), { hour: "numeric", minute: "2-digit" }) : "";
		const line =
			state === "synced" ? (when ? m.docs_google_in_step_since({ time: when }) : m.docs_google_in_step())
			: state === "syncing" ? m.docs_google_sending()
			: (remoteStatus?.message ?? "");
		const said = el("div", { class: "g-said", "data-ok": String(state === "synced" || state === "syncing") }, line);
		const parts: HTMLElement[] = [head, open, said];
		if (state === "signin" && options.api) parts.push(...signInParts());
		const who = remoteStatus?.mode === "fake" ? m.docs_google_fake() : remoteStatus?.email ? m.docs_google_signed_in_as({ email: remoteStatus.email }) : "";
		if (who) parts.push(el("div", { class: "g-note" }, who));
		googleMenu.replaceChildren(...parts);
	}

	googleButton.onclick = () => {
		const opening = googleMenu.hidden;
		googleMenu.hidden = !opening;
		googleButton.setAttribute("aria-pressed", String(opening));
		drawGoogle();
	};
	const outside = (event: MouseEvent) => {
		if (!googleBox.contains(event.target as Node)) {
			googleMenu.hidden = true;
			googleButton.setAttribute("aria-pressed", "false");
		}
	};
	document.addEventListener("mousedown", outside);

	ctx.on("doc.remote", (message) => {
		remoteStatus = message.status;
		drawGoogle();
	});
	ctx.on("doc.gdoc", (message) => gview.load(message.document as never, message.text));
	ctx.hooks.sendStyle = styleQueue(ctx);
	ctx.hooks.drawGoogle = drawGoogle;
	ctx.hooks.signInParts = signInParts;
	ctx.hooks.remoteStatus = () => remoteStatus;
	return () => document.removeEventListener("mousedown", outside);
}

/**
 * Styles for Google, each with the text the page had when it was made, sent in order once the
 * typing before it has reached the server: the server brings the Doc to that text, applies the
 * style, and only then what was typed after, so a list item made after a bullet is in the list.
 */
function styleQueue(ctx: PageContext): (requests: DocsRequest[]) => void {
	const { sync, options } = ctx;
	const styleQueue: Array<{ requests: DocsRequest[]; text: string; mark: number; hold?: number }> = [];
	/** A keystroke's style is held this long for the next keystroke to join, so a run of bold typing is one request to Google, not one a key. */
	const HOLD_MS = 400;
	let pumping: ReturnType<typeof setTimeout> | undefined;
	function sendStyle(requests: DocsRequest[]): void {
		// A keystroke's style that carries on the one before it, not yet sent, goes out as one request.
		const last = styleQueue[styleQueue.length - 1];
		const [a] = last?.requests ?? [];
		const [b] = requests;
		if (last?.requests.length === 1 && requests.length === 1 && a && b && "updateTextStyle" in a && "updateTextStyle" in b && a.updateTextStyle.range.endIndex === b.updateTextStyle.range.startIndex && JSON.stringify([a.updateTextStyle.textStyle, a.updateTextStyle.fields]) === JSON.stringify([b.updateTextStyle.textStyle, b.updateTextStyle.fields])) {
			last.requests = [{ updateTextStyle: { ...a.updateTextStyle, range: { startIndex: a.updateTextStyle.range.startIndex, endIndex: b.updateTextStyle.range.endIndex } } }];
			last.text = sync.text;
			last.mark = sync.mark();
			last.hold = Date.now() + HOLD_MS;
		} else styleQueue.push({ requests, text: sync.text, mark: sync.mark(), ...(requests.length === 1 && b && "updateTextStyle" in b ? { hold: Date.now() + HOLD_MS } : {}) });
		pump();
	}
	function pump(): void {
		clearTimeout(pumping);
		pumping = undefined;
		sync.flush();
		while (styleQueue.length && sync.landed(styleQueue[0]!.mark) && (styleQueue.length > 1 || (styleQueue[0]!.hold ?? 0) <= Date.now())) {
			const next = styleQueue.shift()!;
			options.send({ type: "doc.gstyle", path: sync.path, client: sync.client, requests: next.requests, text: next.text });
		}
		if (styleQueue.length) pumping = setTimeout(pump, 30);
	}
	return sendStyle;
}
