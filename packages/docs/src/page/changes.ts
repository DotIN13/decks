import { getLocale, m } from "@decks/i18n";
import type { PageContext } from "./context.ts";
import { clip, el, iconButton, initial, whoOf } from "./ui.ts";

/**
 * The changes waiting for review: the Changes panel listing each with who made it, a snippet, and
 * Accept and Reject (one or all); and the pill over a change's highlight in the page, to take or
 * leave that one where it is. Hovering either lights the change's words.
 */

export function mountChanges(ctx: PageContext): () => void {
	const { sync, live, gview } = ctx;
	const { panel, pill, main, scroll } = ctx.dom;
	let changesDrawn = "";
	const changesKey = () => `${sync.readOnly}|${sync.changes.map((c) => c.id).join(",")}`;

	function drawChanges(): void {
		changesDrawn = changesKey();
		const extra: HTMLElement[] = [];
		if (sync.changes.length > 0 && !sync.readOnly) {
			const all = el("button", { type: "button", class: "dp-btn dp-sm dp-primary", title: m.docs_accept_all_title() }, m.docs_accept_all());
			const none = el("button", { type: "button", class: "dp-btn dp-sm dp-outline", title: m.docs_reject_all_title() }, m.docs_reject_all());
			all.onclick = () => sync.accept("*");
			none.onclick = () => sync.reject("*");
			extra.push(all, none);
		}
		panel.replaceChildren(ctx.hooks.header(m.docs_changes(), ...extra));
		if (sync.changes.length === 0) panel.append(el("p", { class: "dp-empty" }, m.docs_nothing_to_review()));
		for (const change of [...sync.changes].reverse()) {
			const item = el("div", { class: "dp-change", "data-change": change.id });
			const who = el("div", { class: "dp-who" });
			who.append(el("span", { class: "dp-av" }, initial(change.by)), el("b", {}, whoOf(change.by)), new Date(change.at).toLocaleTimeString(getLocale(), { hour: "numeric", minute: "2-digit" }));
			if (!sync.readOnly) {
				const acts = el("div", { class: "dp-acts" });
				const yes = iconButton("check", m.docs_accept(), "dp-ib dp-sm dp-yes");
				const no = iconButton("x", m.docs_reject(), "dp-ib dp-sm dp-no");
				yes.onclick = (event) => (event.stopPropagation(), sync.accept(change.id));
				no.onclick = (event) => (event.stopPropagation(), sync.reject(change.id));
				acts.append(yes, no);
				who.append(acts);
			}
			const snip = el("div", { class: "dp-snip" });
			for (const splice of change.splices.slice(0, 4)) {
				if (splice.before) snip.append(el("del", {}, clip(splice.before, 60)));
				if (splice.text) snip.append(el("ins", {}, clip(splice.text, 60)));
				snip.append(" ");
			}
			if (change.splices.length > 4) snip.append(`+${change.splices.length - 4}`);
			item.append(who, snip);
			item.onmouseenter = () => hot(change.id, true);
			item.onmouseleave = () => hot(change.id, false);
			item.onclick = () => (ctx.isGoogle() ? gview.page : live.root).querySelector(`[data-change="${change.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
			panel.append(item);
		}
	}

	function hot(change: string, on: boolean): void {
		for (const node of (ctx.isGoogle() ? gview.page : live.root).querySelectorAll<HTMLElement>(`[data-change="${change}"]`)) node.toggleAttribute("data-hot", on);
	}

	// One change, from its highlight: a pill over the words with who made it, Accept and Reject.
	let pillFor: string | undefined;
	let pillTimer: ReturnType<typeof setTimeout> | undefined;
	function showPill(target: HTMLElement): void {
		const id = target.dataset.change!;
		const change = sync.changes.find((c) => c.id === id);
		if (!change || sync.readOnly || ctx.hooks.isViewing()) return;
		clearTimeout(pillTimer);
		if (pillFor !== id) {
			pillFor = id;
			const yes = iconButton("check", m.docs_accept(), "dp-ib dp-sm dp-yes");
			const no = iconButton("x", m.docs_reject(), "dp-ib dp-sm dp-no");
			yes.onclick = () => (sync.accept(id), hidePill(true));
			no.onclick = () => (sync.reject(id), hidePill(true));
			const who = el("span", { class: "p-who" });
			who.append(el("span", { class: "dp-av" }, initial(change.by)), el("b", {}, whoOf(change.by)), new Date(change.at).toLocaleTimeString(getLocale(), { hour: "numeric", minute: "2-digit" }));
			pill.replaceChildren(who, yes, no);
		}
		pill.hidden = false;
		const box = target.getBoundingClientRect();
		const frame = main.getBoundingClientRect();
		const left = Math.max(8, Math.min(box.left - frame.left, frame.width - pill.offsetWidth - 8));
		const above = box.top - frame.top - pill.offsetHeight - 6;
		pill.style.left = `${left}px`;
		pill.style.top = `${above < 4 ? box.bottom - frame.top + 6 : above}px`;
		hot(id, true);
	}
	function hidePill(now = false): void {
		clearTimeout(pillTimer);
		const go = () => {
			if (pillFor) hot(pillFor, false);
			pill.hidden = true;
			pillFor = undefined;
		};
		if (now) go();
		else pillTimer = setTimeout(go, 350);
	}
	for (const surface of [live.root, gview.page]) {
		surface.addEventListener("mouseover", (event) => {
			const target = (event.target as HTMLElement).closest<HTMLElement>("[data-change]");
			if (target && surface.contains(target)) showPill(target);
			else if (pillFor) hidePill();
		});
		surface.addEventListener("mouseleave", () => hidePill());
	}
	pill.addEventListener("mouseenter", () => clearTimeout(pillTimer));
	pill.addEventListener("mouseleave", () => hidePill());
	scroll.addEventListener("scroll", () => hidePill(true));

	ctx.hooks.drawChanges = (onlyIfChanged = false) => {
		if (!onlyIfChanged || changesDrawn !== changesKey()) drawChanges();
	};
	return () => {};
}
