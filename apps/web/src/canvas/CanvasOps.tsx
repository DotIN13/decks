import X from "lucide-solid/icons/x";
import { For, Match, Show, Switch } from "solid-js";
import { Icon } from "../icons.tsx";
import { canHover } from "../lib/panels.ts";
import { tokens } from "./keycaps.ts";

/**
 * What you can do to the canvas, in one place you can open and close.
 *
 * The same content spent a while as a line of grey text under the input bar, and then as a
 * tip rotating through the composer's placeholder. Both were wrong in the same way: they
 * put reference material where a person is *working*, so it was either permanently in the
 * way or arriving at a moment nobody asked. Reference belongs behind a button — absent
 * until wanted, complete when opened, and gone again on a click.
 *
 * **Grouped by what you are trying to do**, not by which key does it. Somebody opening this
 * has a goal ("how do I move a thing?") and not a keystroke, so the headings are the goals
 * and the gestures sit under them.
 *
 * Every row is checked against the code that implements it: `Stage.shortcut` and
 * `TOOL_KEYS` for the camera and the tools, `Editor.ts` for selection and editing,
 * `file-drop.ts` for the drop, `BoardFrame.tsx` for the board's own chrome. A cheat sheet
 * that lies is worse than none, so where the two disagree this file is the one that is
 * wrong.
 */
interface Group {
	title: string;
	rows: Array<{ keys: string; what: string }>;
}

/** With a cursor and a keyboard. */
function pointerGroups(): Group[] {
	return [
		{
			title: "Moving around",
			rows: [
				{ keys: "two-finger scroll", what: "pan the canvas" },
				{ keys: "pinch · ⌘-wheel", what: "zoom about the pointer" },
				{ keys: "space-drag", what: "pan from anywhere, including over a board" },
				{ keys: "+ · -", what: "zoom about the centre" },
				{ keys: "0", what: "fit every board on screen" },
				{ keys: "1", what: "fit the selected board" },
			],
		},
		{
			title: "Drawing",
			rows: [
				{ keys: "V", what: "select, drag and resize" },
				{ keys: "S", what: "sticky" },
				{ keys: "C", what: "card" },
				{ keys: "T", what: "text" },
				{ keys: "E", what: "embed a file" },
				{ keys: "drop a file on a board", what: "embed it where it landed" },
			],
		},
		{
			title: "Changing a component",
			rows: [
				{ keys: "click", what: "select it" },
				{ keys: "double-click", what: "retype its words in place" },
				{ keys: "drag · drag the corner", what: "move it · resize it" },
				{ keys: "arrows · shift-arrows", what: "nudge · nudge by one pixel" },
				{ keys: "⌘D", what: "duplicate it" },
				{ keys: "[ · ]", what: "send behind · bring in front" },
				{ keys: "⌫", what: "delete it" },
				{ keys: "⌘Z", what: "undo on this board" },
				{ keys: "Escape", what: "let the selection go" },
			],
		},
		{
			title: "Boards and the conversation",
			rows: [
				{ keys: "drag a board's title", what: "move the board" },
				{ keys: "the board's ×", what: "take it off the canvas, keeping it in context" },
				{ keys: "the panel buttons", what: "the agents · the boards they are holding" },
				{ keys: "the grid button", what: "every board in the deck, searchable" },
				{ keys: "the speech-bubble button", what: "the conversation, opened and closed" },
				{ keys: "click a turn on the right spine", what: "the conversation at that turn" },
				{ keys: "/", what: "commands, in the input bar" },
			],
		},
	];
}

/** With a finger. A phone has no wheel, no space bar and no keys to fit with. */
function touchGroups(): Group[] {
	return [
		{
			title: "Moving around",
			rows: [
				{ keys: "drag", what: "pan the canvas" },
				{ keys: "pinch", what: "zoom about the fingers" },
				{ keys: "drag inside an embed", what: "scrolls the embed, not the canvas" },
			],
		},
		{
			title: "Changing a component",
			rows: [
				{ keys: "tap", what: "select it" },
				{ keys: "tap again", what: "retype its words in place" },
				{ keys: "drag a selected component", what: "move it" },
				{ keys: "the properties sheet", what: "kind, tone, order, duplicate, delete" },
			],
		},
		{
			title: "Drawing",
			rows: [
				{ keys: "pick a tool, then tap", what: "place a sticky, card, text or embed" },
				{ keys: "from this device, in the picker", what: "add a photo or a file to the deck" },
			],
		},
		{
			title: "Boards and the conversation",
			rows: [
				{ keys: "drag a board's title", what: "move the board" },
				{ keys: "swipe in from the left edge", what: "the boards and agents rail" },
				{ keys: "swipe in from the right edge", what: "the conversation" },
				{ keys: "swipe the conversation right", what: "put it away" },
				{ keys: "the two title-bar buttons", what: "the same two panels, either way" },
				{ keys: "/", what: "commands, in the input bar" },
			],
		},
	];
}

export function CanvasOps(props: { onClose: () => void }) {
	const groups = () => (canHover() ? pointerGroups() : touchGroups());

	return (
		<div
			class="picker-backdrop"
			onPointerDown={(event) => {
				// The same rule the file picker documents: a press that *begins* on the
				// backdrop, so a ghost click from the tap that opened this cannot close it.
				if (event.target === event.currentTarget) props.onClose();
			}}
		>
			{/*
				`ops` stays as a class for one reason: the single-column fallback below 560px is a
				media query, and the rest of the sheet is ordinary layout that reads better as
				utilities than as a stylesheet nobody needs to look up.

				Opaque, unlike the panels whose class it borrows: this is two dense columns of
				small text and there is nothing behind it worth reading through it.
			*/}
			<div
				class="panel-float ops flex max-h-[78%] w-[min(560px,calc(100vw-24px))] static flex-col overflow-hidden bg-bg p-0"
				role="dialog"
				aria-label="What you can do on the canvas"
			>
				<header class="flex items-center gap-2 border-b border-line py-2 pr-2.5 pl-3 text-[11px] tracking-[0.04em] text-muted uppercase">
					<span>on the canvas</span>
					<span class="flex-1" />
					<button class="icon-button" type="button" title="Close" aria-label="Close" onClick={props.onClose}>
						<Icon of={X} size={16} />
					</button>
				</header>

				<div class="flex flex-col gap-3.5 overflow-y-auto overscroll-contain px-3 pt-2.5 pb-3">
					<For each={groups()}>
						{(group) => (
							<section>
								<h3 class="mt-0 mb-[5px] text-[12px] font-semibold text-fg">{group.title}</h3>
								<For each={group.rows}>
									{(row) => (
										// 13em of keys and a sentence beside it is two lines of neither on a
										// phone, so the grid collapses to one column there.
										<div
											class="row grid grid-cols-[minmax(0,13em)_minmax(0,1fr)] gap-2.5 py-0.5 text-[12px] leading-[1.5] max-[560px]:grid-cols-[minmax(0,1fr)] max-[560px]:gap-0 max-[560px]:py-1"
										>
											<span class="flex flex-wrap items-center gap-1">
												<For each={tokens(row.keys)}>
													{(token) => (
														<Switch>
															{/*
																A keycap: bordered, raised a hair off the panel by one
																line of shadow, and never narrower than it is tall — so
																`0` and `⌘D` read as the same family of object rather
																than a square and a rectangle.
															*/}
															<Match when={"cap" in token && token.cap}>
																{(cap) => (
																	<kbd class="inline-grid min-w-[1.7em] place-items-center rounded-[5px] border border-line-strong bg-bg-deep px-1.5 py-px font-mono text-[11px] leading-[1.5] text-fg shadow-[0_1px_0_var(--line-strong)]">
																		{cap()}
																	</kbd>
																)}
															</Match>
															{/* "either of these": the dot is the renderer's, not the data's. */}
															<Match when={"or" in token}>
																<span class="px-px text-faint">·</span>
															</Match>
															<Match when={"word" in token && token.word}>
																{(word) => <span class="text-muted">{word()}</span>}
															</Match>
														</Switch>
													)}
												</For>
											</span>
											<span class="text-muted">{row.what}</span>
										</div>
									)}
								</For>
							</section>
						)}
					</For>
				</div>

				{/* Said once, at the bottom, because it is the rule behind half the rows above:
				    below `INTERACT_ZOOM` a board takes no pointer events at all. */}
				<Show when={canHover()}>
					<footer class="border-t border-line px-3 py-[9px] text-[11px] leading-normal text-faint">
						Zoomed out far enough, a board is a tile on a map: drag it to move it, and zoom in to work inside it.
					</footer>
				</Show>
			</div>
		</div>
	);
}
