import { createSignal, onCleanup, onMount } from "solid-js";
import { panelOpen, setPanelOpen } from "../../state/index.ts";
import { CHAT_FOLDED_KEY, CHAT_HEIGHT_KEY, clampHeight, dragSpeed, keyStep, revealInset, sheetFling, sheetGoes } from "./model.ts";

/** The layout's own state. */
export function createChatLayout() {
	const [viewWidth, setViewWidth] = createSignal(window.innerWidth);
	onMount(() => {
		const resized = () => setViewWidth(window.innerWidth);
		window.addEventListener("resize", resized);
		onCleanup(() => window.removeEventListener("resize", resized));
	});
	const phone = () => viewWidth() < 600;
	const [chatFolded, setChatFoldedRaw] = createSignal(readChatFolded());
	const setChatFolded = (folded: boolean) => {
		setChatFoldedRaw(folded);
		try {
			localStorage.setItem(CHAT_FOLDED_KEY, folded ? "1" : "0");
		} catch {
			// Kept for the session.
		}
	};
	const [phoneChat, setPhoneChatRaw] = createSignal(false);
	/* The pill the phone's sheet opens out of, and the sheet's way out: it leaves quicker than it came. */
	const [sheetFrom, setSheetFrom] = createSignal<DOMRect | undefined>();
	const [sheetLeaving, setSheetLeaving] = createSignal(false);
	const setPhoneChat = (open: boolean, from?: DOMRect, gone = false) => {
		// Dragged off the screen already: it goes now, with no leaving animation after its own.
		if (!open && gone) {
			setSheetLeaving(false);
			return void setPhoneChatRaw(false);
		}
		if (open) {
			setSheetFrom(from ?? document.querySelector(".v3-status")?.getBoundingClientRect());
			setSheetLeaving(false);
			return void setPhoneChatRaw(true);
		}
		if (!phoneChat() || sheetLeaving()) return;
		setSheetLeaving(true);
		// As long as its slide off the screen (`v3-sheet-out`).
		setTimeout(() => {
			setPhoneChatRaw(false);
			setSheetLeaving(false);
		}, 260);
	};
	/** Whether the conversation is on screen: the panel's lower half, or the phone's sheet. */
	const chatShown = () => (phone() ? phoneChat() : panelOpen() && !chatFolded());
	const openChat = () => {
		if (phone()) return void setPhoneChat(true);
		setPanelOpen(true);
		setChatFolded(false);
		holdHistory();
	};
	return { viewWidth, phone, chatFolded, setChatFolded, phoneChat, setPhoneChat, sheetFrom, sheetLeaving, chatShown, openChat, holdHistory };
}

/*
 * While the conversation grows open or folds, its history stays where it rests: pinned to the
 * bottom every frame, so the panel uncovers the messages rather than carrying them along.
 */
export const holdHistory = (ms = 320) => {
	const until = performance.now() + ms;
	const pin = () => {
		for (const roll of document.querySelectorAll<HTMLElement>(".v3-chat .stream-roll")) roll.scrollTop = roll.scrollHeight;
		if (performance.now() < until) requestAnimationFrame(pin);
	};
	pin();
};

/** Present: the canvas alone, full screen. Escape, or leaving full screen, brings the chrome back. */
export function createPresenting() {
	const [presenting, setPresenting] = createSignal(false);
	const present = () => {
		setPresenting(true);
		void document.documentElement.requestFullscreen?.().catch(() => {});
	};
	onMount(() => {
		const keys = (event: KeyboardEvent) => {
			if (event.key === "Escape" && presenting()) setPresenting(false);
		};
		const left = () => {
			if (!document.fullscreenElement) setPresenting(false);
		};
		window.addEventListener("keydown", keys);
		document.addEventListener("fullscreenchange", left);
		onCleanup(() => {
			window.removeEventListener("keydown", keys);
			document.removeEventListener("fullscreenchange", left);
		});
	});
	return { presenting, present };
}

/** Whether the panel's conversation was folded on this device. */
function readChatFolded(): boolean {
	try {
		return localStorage.getItem(CHAT_FOLDED_KEY) === "1";
	} catch {
		return false;
	}
}

/** The section and its panel, as the handlers below need them. */
export interface SectionHost {
	section: () => HTMLElement | undefined;
	folded: () => boolean;
	sheet: () => boolean;
	onFold: (folded: boolean, gone?: boolean) => void;
}

const panelOf = (host: SectionHost) => host.section()?.closest<HTMLElement>(".panel-shell") ?? null;

/** Set the conversation's height on its panel, or give the panel back its own split. */
export function applyHeight(host: SectionHost, h: number | undefined): void {
	const p = panelOf(host);
	if (!p) return;
	if (h === undefined) {
		p.style.removeProperty("--v3-chat-h");
		delete p.dataset.chatSized;
	} else {
		p.style.setProperty("--v3-chat-h", `${clampHeight(h, p.clientHeight)}px`);
		p.dataset.chatSized = "true";
	}
}

/** Remember the height on this device; if storage refuses, it is kept for the session. */
export function saveHeight(host: SectionHost, h: number | undefined): void {
	try {
		if (h === undefined) localStorage.removeItem(CHAT_HEIGHT_KEY);
		else localStorage.setItem(CHAT_HEIGHT_KEY, String(clampHeight(h, panelOf(host)?.clientHeight)));
	} catch {
		// Kept for the session.
	}
}

/** The remembered height, put back when the section mounts in the panel. */
export function restoreHeight(host: SectionHost): void {
	if (host.sheet()) return;
	const saved = Number(localStorage.getItem(CHAT_HEIGHT_KEY) ?? "");
	if (saved > 0) applyHeight(host, saved);
}

/** Both at once: what a double-click on the handle, and Home, do. */
export function resetHeight(host: SectionHost): void {
	applyHeight(host, undefined);
	saveHeight(host, undefined);
}

/** Window listeners for one drag, removed together. */
function listen(handlers: { move: (e: PointerEvent) => void; end: (e: PointerEvent) => void }, blur?: () => void): () => void {
	window.addEventListener("pointermove", handlers.move, true);
	window.addEventListener("pointerup", handlers.end, true);
	window.addEventListener("pointercancel", handlers.end, true);
	if (blur) window.addEventListener("blur", blur);
	return () => {
		window.removeEventListener("pointermove", handlers.move, true);
		window.removeEventListener("pointerup", handlers.end, true);
		window.removeEventListener("pointercancel", handlers.end, true);
		if (blur) window.removeEventListener("blur", blur);
	};
}

/** Drag the line above the conversation; it ends however the button comes up, or on a lost capture. */
export function startResize(host: SectionHost, event: PointerEvent): void {
	const section = host.section();
	if (event.button !== 0 || host.folded() || !section) return;
	const handle = event.currentTarget as HTMLElement;
	const bottom = section.getBoundingClientRect().bottom;
	try {
		handle.setPointerCapture(event.pointerId);
	} catch {
		// A capture refused still leaves the window listeners below.
	}
	event.preventDefault();
	const p = panelOf(host);
	if (p) p.dataset.chatResizing = "true";
	let done = false;
	const end = () => {
		if (done) return;
		done = true;
		stop();
		handle.removeEventListener("lostpointercapture", end);
		try {
			handle.releasePointerCapture(event.pointerId);
		} catch {
			// Already gone.
		}
		if (p) delete p.dataset.chatResizing;
		saveHeight(host, host.section()?.getBoundingClientRect().height);
	};
	// A mouse moved with no button held has been let go of somewhere.
	const move = (m: PointerEvent) => (m.pointerType === "mouse" && m.buttons === 0 ? end() : applyHeight(host, bottom - m.clientY));
	const stop = listen({ move, end }, end);
	handle.addEventListener("lostpointercapture", end);
}

/** The arrows step the height by 16 px; Home gives the panel back its own split. */
export function keyResize(host: SectionHost, event: KeyboardEvent): void {
	const step = keyStep(event.key);
	if (step === undefined) return;
	if (step === "reset") resetHeight(host);
	else {
		const now = (host.section()?.getBoundingClientRect().height ?? 0) + step;
		applyHeight(host, now);
		saveHeight(host, now);
	}
	event.preventDefault();
}

/** On a phone, the sheet opens out of the pill it was pressed from. */
export function revealSheet(section: HTMLElement | undefined, from: DOMRect | undefined): void {
	if (!from || !section || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const inset = revealInset(from, section.getBoundingClientRect());
	section.animate([{ clipPath: inset }, { clipPath: "inset(0 0 0 0 round 26px)" }], { duration: 340, easing: "cubic-bezier(.2,.8,.2,1)" });
}

/** The press that dragged the sheet is not also a click on its title or chevron. */
function swallowNextClick(sheet: HTMLElement): void {
	const swallow = (click: Event) => {
		click.stopPropagation();
		click.preventDefault();
	};
	sheet.addEventListener("click", swallow, { capture: true, once: true });
	setTimeout(() => sheet.removeEventListener("click", swallow, { capture: true }), 0);
}

/** Let go: away off the screen at the finger's speed, or back to rest. */
function releaseSheet(host: SectionHost, sheet: HTMLElement, dy: number, speed: number, cancelled: boolean): void {
	if (sheetGoes(dy, sheet.offsetHeight, speed, cancelled)) {
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) return host.onFold(true);
		const { off, ms, easing } = sheetFling(dy, sheet.offsetHeight, speed);
		const away = sheet.animate([{ transform: `translateY(${dy}px)` }, { transform: `translateY(${off}px)` }], { duration: ms, easing, fill: "forwards" });
		// Already off the screen: no leaving animation of its own after this one.
		away.onfinish = () => host.onFold(true, true);
		return;
	}
	sheet.dataset.settling = "true";
	sheet.style.transform = "";
	setTimeout(() => delete sheet.dataset.settling, 300);
}

/** The phone's sheet, dragged down by its handle or head, goes as an iOS sheet goes. */
export function startSheetDrag(host: SectionHost, event: PointerEvent): void {
	const sheet = host.section();
	if (!host.sheet() || !sheet || event.button !== 0) return;
	const target = event.target instanceof Element ? event.target : null;
	if (!target?.closest(".v3-sheet-handle, .v3-chat-head")) return;
	const startY = event.clientY;
	// The recent moves, for how fast it was going over the last 80 ms when let go.
	const recent: Array<{ y: number; t: number }> = [{ y: event.clientY, t: event.timeStamp }];
	let dy = 0;
	let moved = false;
	const move = (next: PointerEvent) => {
		if (next.pointerId !== event.pointerId) return;
		dy = Math.max(0, next.clientY - startY);
		if (!moved && Math.abs(next.clientY - startY) < 6) return;
		if (!moved) {
			moved = true;
			sheet.dataset.dragged = "true";
			delete sheet.dataset.settling;
		}
		// Pulled up past where it rests, it gives a little, as a sheet does.
		sheet.style.transform = `translateY(${dy > 0 ? dy : Math.min(0, next.clientY - startY) / 6}px)`;
		recent.push({ y: next.clientY, t: next.timeStamp });
		while (recent.length > 2 && next.timeStamp - recent[0]!.t > 80) recent.shift();
	};
	const end = (done: PointerEvent) => {
		if (done.pointerId !== event.pointerId) return;
		stop();
		if (!moved) return;
		swallowNextClick(sheet);
		delete sheet.dataset.dragged;
		releaseSheet(host, sheet, dy, dragSpeed(recent), done.type === "pointercancel");
	};
	const stop = listen({ move, end });
}
