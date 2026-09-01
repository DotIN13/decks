import X from "lucide-solid/icons/x";
import { For, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { canHover } from "../lib/panels.ts";

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
				{ keys: "reach the left edge", what: "the boards and agents rail comes out" },
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
				{ keys: "the panel button", what: "the boards and agents rail" },
				{ keys: "the speech-bubble button", what: "the conversation" },
				{ keys: "swipe the conversation right", what: "put it away" },
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
			<div class="panel-float ops" role="dialog" aria-label="What you can do on the canvas">
				<header>
					<span class="where">on the canvas</span>
					<span class="spacer" />
					<button class="icon-button" type="button" title="Close" aria-label="Close" onClick={props.onClose}>
						<Icon of={X} size={16} />
					</button>
				</header>

				<div class="groups">
					<For each={groups()}>
						{(group) => (
							<section>
								<h3>{group.title}</h3>
								<For each={group.rows}>
									{(row) => (
										<div class="row">
											<span class="keys">{row.keys}</span>
											<span class="what">{row.what}</span>
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
					<footer>Zoomed out far enough, a board is a tile on a map: drag it to move it, and zoom in to work inside it.</footer>
				</Show>
			</div>
		</div>
	);
}
