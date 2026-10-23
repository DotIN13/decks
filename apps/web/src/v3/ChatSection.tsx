import type { AgentChat, AgentState, Identity } from "@decks/protocol";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronsDownUp from "lucide-solid/icons/chevrons-down-up";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import { isWorking, workingWords } from "@decks/agent-ui/chat";
import { onMount, Show, type JSX } from "solid-js";
import { AgentFace } from "../agents/AgentPill.tsx";
import { Icon } from "../ui/icons.tsx";

/** What an agent is doing, said after its name: "running tools…", "waiting for you", or nothing. */
export function stateWords(state: AgentState, name: string): string | undefined {
	if (state === "waiting") return "waiting for you";
	const words = workingWords(state, name);
	return words && isWorking(state) ? words : undefined;
}

/**
 * The conversation, as the lower half of the side panel: whose it is and what it is doing, then
 * the turns. Folded, it is one line pinned to the panel's foot that says how many turns arrived
 * since, and opens again.
 *
 * On a phone the same head tops a sheet over the canvas that grows out of the composer
 * (`sheet`), and its chevron puts it back into the pill.
 */
export function ChatSection(props: {
	chat: AgentChat | undefined;
	identity: Identity | undefined;
	unread: number;
	folded: boolean;
	onFold: (folded: boolean) => void;
	sheet?: boolean;
	/** On a phone: the pill the sheet opens out of. The sheet uncovers its history from that shape, rather than scaling it. */
	from?: DOMRect;
	/** On a phone: the sheet is on its way out. */
	leaving?: boolean;
	children: JSX.Element;
}) {
	let section: HTMLElement | undefined;
	/*
	 * The conversation's height in the panel is the person's: the line above it is a handle. Dragged,
	 * it sets the height on the panel (`--v3-chat-h`, `data-chat-sized`), remembered on this device;
	 * a double-click gives the panel back its own split. Kept between 120px and all but 160px of the
	 * panel, so neither the list nor the conversation can be dragged out of reach.
	 */
	const panel = () => section?.closest<HTMLElement>(".panel-shell") ?? null;
	const clamp = (h: number) => {
		const p = panel();
		const most = p ? p.clientHeight - 160 : 900;
		return Math.round(Math.max(120, Math.min(most, h)));
	};
	const applyHeight = (h: number | undefined) => {
		const p = panel();
		if (!p) return;
		if (h === undefined) {
			p.style.removeProperty("--v3-chat-h");
			delete p.dataset.chatSized;
		} else {
			p.style.setProperty("--v3-chat-h", `${clamp(h)}px`);
			p.dataset.chatSized = "true";
		}
	};
	const saveHeight = (h: number | undefined) => {
		try {
			if (h === undefined) localStorage.removeItem(CHAT_HEIGHT_KEY);
			else localStorage.setItem(CHAT_HEIGHT_KEY, String(clamp(h)));
		} catch {
			// Kept for the session.
		}
	};
	onMount(() => {
		if (props.sheet) return;
		const saved = Number(localStorage.getItem(CHAT_HEIGHT_KEY) ?? "");
		if (saved > 0) applyHeight(saved);
	});
	/*
	 * The drag ends however the button comes up: on the handle, anywhere in the window, outside it,
	 * over a board's frame (which swallows the pointer), on a lost capture, or when the window loses
	 * focus. A move with no button held ends it too, so a release nobody reported cannot leave the
	 * handle stuck to the pointer.
	 */
	const startResize = (event: PointerEvent) => {
		if (event.button !== 0 || props.folded || !section) return;
		const handle = event.currentTarget as HTMLElement;
		const bottom = section.getBoundingClientRect().bottom;
		try {
			handle.setPointerCapture(event.pointerId);
		} catch {
			// A capture refused still leaves the window listeners below.
		}
		event.preventDefault();
		const p = panel();
		if (p) p.dataset.chatResizing = "true";
		let done = false;
		const move = (m: PointerEvent) => {
			if (m.buttons === 0) return end();
			applyHeight(bottom - m.clientY);
		};
		const end = () => {
			if (done) return;
			done = true;
			window.removeEventListener("pointermove", move, true);
			window.removeEventListener("pointerup", end, true);
			window.removeEventListener("pointercancel", end, true);
			window.removeEventListener("blur", end);
			handle.removeEventListener("lostpointercapture", end);
			try {
				handle.releasePointerCapture(event.pointerId);
			} catch {
				// Already gone.
			}
			if (p) delete p.dataset.chatResizing;
			saveHeight(section?.getBoundingClientRect().height);
		};
		window.addEventListener("pointermove", move, true);
		window.addEventListener("pointerup", end, true);
		window.addEventListener("pointercancel", end, true);
		window.addEventListener("blur", end);
		handle.addEventListener("lostpointercapture", end);
	};
	const keyResize = (event: KeyboardEvent) => {
		const now = section?.getBoundingClientRect().height ?? 0;
		const step = event.key === "ArrowUp" ? 16 : event.key === "ArrowDown" ? -16 : 0;
		if (event.key === "Home") {
			applyHeight(undefined);
			saveHeight(undefined);
		} else if (step) {
			applyHeight(now + step);
			saveHeight(now + step);
		} else return;
		event.preventDefault();
	};
	onMount(() => {
		const from = props.from;
		if (!props.sheet || !from || !section || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const to = section.getBoundingClientRect();
		const inset = `inset(${Math.max(0, from.top - to.top)}px ${Math.max(0, to.right - from.right)}px ${Math.max(0, to.bottom - from.bottom)}px ${Math.max(0, from.left - to.left)}px round 17px)`;
		section.animate([{ clipPath: inset }, { clipPath: "inset(0 0 0 0 round 26px)" }], { duration: 340, easing: "cubic-bezier(.2,.8,.2,1)" });
	});
	/*
	 * The sheet is put away as an iOS sheet is: its handle or its head dragged down carries it with
	 * the finger, and let go past a quarter of its height, or flicked down, it goes; short of that
	 * it springs back. A drag never also presses what it started on (the title, the chevron).
	 */
	const startSheetDrag = (event: PointerEvent) => {
		if (!props.sheet || !section || event.button !== 0) return;
		const target = event.target instanceof Element ? event.target : null;
		if (!target?.closest(".v3-sheet-handle, .v3-chat-head")) return;
		const sheet = section;
		const start = { y: event.clientY, t: event.timeStamp };
		// The recent moves, for how fast it was going over the last 80 ms when let go.
		const recent: Array<{ y: number; t: number }> = [{ y: event.clientY, t: event.timeStamp }];
		let dy = 0;
		let moved = false;
		const move = (next: PointerEvent) => {
			if (next.pointerId !== event.pointerId) return;
			dy = Math.max(0, next.clientY - start.y);
			if (!moved && Math.abs(next.clientY - start.y) < 6) return;
			if (!moved) {
				moved = true;
				sheet.dataset.dragged = "true";
				delete sheet.dataset.settling;
			}
			// Pulled up past where it rests, it gives a little, as a sheet does.
			const up = Math.min(0, next.clientY - start.y);
			sheet.style.transform = `translateY(${dy > 0 ? dy : up / 6}px)`;
			recent.push({ y: next.clientY, t: next.timeStamp });
			while (recent.length > 2 && next.timeStamp - recent[0]!.t > 80) recent.shift();
		};
		const end = (done: PointerEvent) => {
			if (done.pointerId !== event.pointerId) return;
			window.removeEventListener("pointermove", move, true);
			window.removeEventListener("pointerup", end, true);
			window.removeEventListener("pointercancel", end, true);
			if (!moved) return;
			// The press that dragged is not also a click on the title or the chevron.
			const swallow = (click: Event) => {
				click.stopPropagation();
				click.preventDefault();
			};
			sheet.addEventListener("click", swallow, { capture: true, once: true });
			setTimeout(() => sheet.removeEventListener("click", swallow, { capture: true }), 0);
			delete sheet.dataset.dragged;
			const first = recent[0]!;
			const last = recent[recent.length - 1]!;
			const speed = (last.y - first.y) / Math.max(1, last.t - first.t);
			if (done.type !== "pointercancel" && (dy > sheet.offsetHeight / 4 || (speed > 0.4 && dy > 24))) {
				// Away from where the finger left it: the leaving animation starts at this offset.
				props.onFold(true);
				return;
			}
			sheet.dataset.settling = "true";
			sheet.style.transform = "";
			setTimeout(() => delete sheet.dataset.settling, 300);
		};
		window.addEventListener("pointermove", move, true);
		window.addEventListener("pointerup", end, true);
		window.addEventListener("pointercancel", end, true);
	};
	const name = () => props.identity?.name ?? props.chat?.name ?? "No agent";
	return (
		<section ref={section} class="v3-chat" data-leaving={props.leaving ? "true" : undefined} data-folded={props.folded ? "true" : undefined} data-sheet={props.sheet ? "true" : undefined} aria-label="The conversation" onPointerDown={startSheetDrag}>
			<Show when={props.sheet}>
				<span class="v3-sheet-handle" aria-hidden="true" />
			</Show>
			<Show when={!props.sheet && !props.folded}>
				<div
					class="v3-chat-resize"
					role="separator"
					aria-orientation="horizontal"
					aria-label="Conversation height"
					tabindex="0"
					onPointerDown={startResize}
					onKeyDown={keyResize}
					onDblClick={() => {
						applyHeight(undefined);
						saveHeight(undefined);
					}}
				/>
			</Show>
			<div class="v3-chat-head">
				<Show when={props.chat}>{(chat) => <AgentFace chat={chat()} identity={props.identity} unread={props.unread} size={24} ring={1.5} />}</Show>
				<button type="button" class="v3-chat-title" title={props.folded ? "Show the conversation" : "Fold the conversation"} onClick={() => props.onFold(!props.folded)}>
					<span class="v3-chat-name">{name()}</span>
					<Show when={props.chat && stateWords(props.chat.state, name())}>{(words) => <span class="v3-chat-state">{words()}</span>}</Show>
				</button>
				<span class="flex-1" />
				<Show when={props.folded && props.unread > 0}>
					<button type="button" class="v3-chat-new" onClick={() => props.onFold(false)}>
						{props.unread} new
					</button>
				</Show>
				<button
					type="button"
					class="v3-icon"
					aria-expanded={!props.folded}
					data-tip={props.sheet ? "Back into the pill" : props.folded ? "Show the conversation" : "Fold the conversation"}
					aria-label={props.folded ? "Show the conversation" : "Fold the conversation"}
					onClick={() => props.onFold(!props.folded)}
				>
					<Icon of={props.sheet ? ChevronDown : props.folded ? ChevronsUpDown : ChevronsDownUp} size={16} />
				</button>
			</div>
			<div class="v3-chat-body">{props.children}</div>
		</section>
	);
}

/**
 * The agent's state as a pill over the composer, while the conversation is out of sight: "✻ Loom
 * is running tools…". Pressing it shows the conversation.
 */
export function StatusPill(props: { chat: AgentChat | undefined; identity: Identity | undefined; onOpen: () => void }) {
	const name = () => props.identity?.name ?? props.chat?.name ?? "";
	const words = () => (props.chat ? stateWords(props.chat.state, name()) : undefined);
	return (
		<Show when={words()}>
			{(said) => (
				<button type="button" class="v3-status float" data-waiting={props.chat?.state === "waiting" ? "true" : undefined} title="Show the conversation" onClick={() => props.onOpen()} aria-live="polite">
					<span class="v3-status-sign" aria-hidden="true">
						✻
					</span>
					<span class="truncate">
						{name()} is {said()}
					</span>
				</button>
			)}
		</Show>
	);
}

const CHAT_HEIGHT_KEY = "decks.chatHeight";
