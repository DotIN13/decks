import CornerDownLeft from "lucide-solid/icons/corner-down-left";
import ListPlus from "lucide-solid/icons/list-plus";
import MessageSquarePlus from "lucide-solid/icons/message-square-plus";
import ArrowUp from "lucide-solid/icons/arrow-up";
import MessageSquare from "lucide-solid/icons/message-square";
import X from "lucide-solid/icons/x";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { setCommentDirty, type CommentTarget } from "../state/comments.ts";
import { Icon } from "../ui/icons.tsx";
import { popupPlace } from "./comments.ts";

/**
 * The comment popup: a button over a selection, and then a box to type into.
 *
 * Two steps on purpose. Selecting words is something a person does all the time while
 * reading, to copy them or for no reason, so what appears first is one small button that is
 * easy to ignore. Pressing it opens the box, and the box ends one of two ways: **with the
 * next message**, which keeps the comment over the input bar, or **now**, which sends it as
 * a message of its own.
 *
 * Enter is the first, ⌘Enter the second, Escape neither.
 */
export function CommentPopup(props: {
	target: CommentTarget;
	/** Anything the position depends on that is not the selection itself: the camera. */
	moved: () => unknown;
	/** Where the canvas starts, in window pixels: the sidebar's width, or 0 with it folded. */
	left: number;
	/** Whether there is an agent to send to right now; without one, only keeping is offered. */
	canSend: boolean;
	onKeep: (text: string) => void;
	onSend: (text: string) => void;
	onClose: () => void;
}) {
	let box: HTMLDivElement | undefined;
	let field: HTMLTextAreaElement | undefined;
	const [open, setOpen] = createSignal(props.target.open ?? false);
	const [text, setText] = createSignal("");
	const [at, setAt] = createSignal<{ left: number; top: number } | undefined>(undefined);

	/** The selection in window pixels: the frame is scaled by the camera, its contents are not. */
	const place = () => {
		const { frame, range, anchor } = props.target;
		if (!box) return;
		if (anchor) {
			const around = anchor();
			if (around) setAt(popupPlace(around, { w: box.offsetWidth, h: box.offsetHeight }, { w: window.innerWidth, h: window.innerHeight, left: props.left }));
			return;
		}
		if (!frame?.isConnected || !range) return;
		const inner = range.getBoundingClientRect();
		const outer = frame.getBoundingClientRect();
		const k = frame.clientWidth > 0 ? outer.width / frame.clientWidth : 1;
		const selection = { left: outer.left + inner.left * k, top: outer.top + inner.top * k, right: outer.left + inner.right * k, bottom: outer.top + inner.bottom * k };
		setAt(popupPlace(selection, { w: box.offsetWidth, h: box.offsetHeight }, { w: window.innerWidth, h: window.innerHeight, left: props.left }));
	};
	createEffect(() => {
		void props.target;
		void props.moved();
		void open();
		// After the DOM has the size the new state gives it.
		queueMicrotask(place);
	});
	onMount(() => {
		if (open()) queueMicrotask(() => field?.focus());
		window.addEventListener("resize", place);
		// A press anywhere else in the app puts it away, unless there is something typed to lose.
		const away = (event: PointerEvent) => {
			if (box?.contains(event.target as Node)) return;
			if (text().trim() === "") props.onClose();
		};
		window.addEventListener("pointerdown", away, true);
		onCleanup(() => {
			setCommentDirty(false);
			window.removeEventListener("resize", place);
			window.removeEventListener("pointerdown", away, true);
		});
	});

	const keep = () => text().trim() !== "" && props.onKeep(text().trim());
	const sendNow = () => text().trim() !== "" && props.canSend && props.onSend(text().trim());

	return (
		<div
			ref={box}
			class="comment-popup floatcard"
			data-open={open()}
			role="dialog"
			aria-label="Comment on the selected words"
			style={{ left: `${at()?.left ?? -9999}px`, top: `${at()?.top ?? -9999}px` }}
			// The press must not take the selection out of the board before it is quoted.
			onPointerDown={(event) => {
				if (!(event.target as HTMLElement).closest("textarea")) event.preventDefault();
			}}
		>
			<Show
				when={open()}
				fallback={
					<button
						type="button"
						class="comment-start"
						onClick={() => {
							setOpen(true);
							queueMicrotask(() => field?.focus());
						}}
					>
						<Icon of={MessageSquarePlus} size={14} />
						<span>Comment</span>
					</button>
				}
			>
				<Show
					when={props.target.quote}
					fallback={<div class="comment-quote" data-whole="true">On the whole board{props.target.title ? `: ${props.target.title}` : ""}</div>}
				>
					<div class="comment-quote" title={props.target.quote}>
						{props.target.quote}
					</div>
				</Show>
				{/* One line that grows, as the question for an agent about a sketch is (`canvas/InkAsk.tsx`): the
				    arrow sends it now, the chip under it keeps it for the next message. */}
				<label class="comment-row">
					<Icon of={MessageSquare} size={15} />
					<textarea
						ref={field}
						class="comment-field"
						rows={1}
						placeholder="Comment on this…"
						value={text()}
						onInput={(event) => {
							setText(event.currentTarget.value);
							setCommentDirty(event.currentTarget.value.trim() !== "");
							// Grows with what is written, to five lines, then scrolls.
							event.currentTarget.style.height = "auto";
							event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 110)}px`;
							queueMicrotask(place);
						}}
						onKeyDown={(event) => {
							event.stopPropagation();
							if (event.key === "Escape") {
								event.preventDefault();
								props.onClose();
							} else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
								event.preventDefault();
								if (event.metaKey || event.ctrlKey) sendNow();
								else keep();
							}
						}}
					/>
					<button
						type="button"
						class="comment-go"
						disabled={text().trim() === "" || !props.canSend}
						aria-label="Send now"
						title={props.canSend ? "Send it to the agent now, as a message of its own (⌘Enter)" : "Pick an agent first"}
						onClick={sendNow}
					>
						<Icon of={ArrowUp} size={15} />
					</button>
				</label>
				<div class="comment-options">
					<button type="button" class="comment-chip" disabled={text().trim() === ""} title="Keep it over the input bar and send it with your next message (Enter)" onClick={keep}>
						<Icon of={ListPlus} size={14} />
						With my next message
						<kbd>
							<Icon of={CornerDownLeft} size={11} />
						</kbd>
					</button>
					<span class="flex-1" />
					<button type="button" class="comment-close" title="Close (Escape)" aria-label="Close" onClick={props.onClose}>
						<Icon of={X} size={14} />
					</button>
				</div>
			</Show>
		</div>
	);
}
