import { createSignal, onCleanup, onMount } from "solid-js";
import { boardsOpen, setBoardsOpen } from "../state/ui.ts";

/**
 * The layout's own state.
 *
 * A phone is under 600px wide: its tools are a row above the composer, the top bars are one,
 * and the conversation is a sheet that grows out of the status pill. Everywhere else the
 * conversation is the side panel's lower half, folded or not, remembered on this device.
 */
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
	const chatShown = () => (phone() ? phoneChat() : boardsOpen() && !chatFolded());
	const openChat = () => {
		if (phone()) return void setPhoneChat(true);
		setBoardsOpen(true);
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

const CHAT_FOLDED_KEY = "decks.chatFolded";

/** Whether the panel's conversation was folded on this device. */
function readChatFolded(): boolean {
	try {
		return localStorage.getItem(CHAT_FOLDED_KEY) === "1";
	} catch {
		return false;
	}
}
