import type { AgentMode } from "@decks/protocol";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ClipboardList from "lucide-solid/icons/clipboard-list";
import Shield from "lucide-solid/icons/shield";
import SquarePen from "lucide-solid/icons/square-pen";
import Zap from "lucide-solid/icons/zap";
import type { LucideIcon } from "lucide-solid";
import { For, Show } from "solid-js";
import { Icon } from "../../icons.tsx";
import { Popover } from "../../ui/Popover.tsx";

/**
 * How much this agent asks before acting, for the rest of the session.
 *
 * **A menu and not a segmented control, and the note is the whole reason.** "edit freely"
 * does not say by itself that commands still ask, and four words in a row of four tabs
 * have nowhere to say it — a `title` on a tab is a fact you can only find by hovering the
 * thing you were already unsure about. So each row is an icon, the word, a tick when it is
 * the current one, and a line of prose about what actually changes.
 *
 * The words are Decks' own — `ask first`, `edit freely`, `plan only`, `auto` — carried over
 * from the `<select>` this replaces, where they were already better than the CLI's
 * `manual / acceptEdits / plan / auto`: they describe what the agent will do rather than
 * naming the mechanism, and the API's names stay on the wire where they belong.
 */
const MODES: Array<{ mode: AgentMode; label: string; icon: LucideIcon; note: string }> = [
	{
		mode: "manual",
		label: "ask first",
		icon: Shield,
		note: "Ask before anything it judges worth asking about.",
	},
	{
		mode: "acceptEdits",
		label: "edit freely",
		icon: SquarePen,
		note: "Stop asking about board edits. Commands still ask.",
	},
	{
		mode: "plan",
		label: "plan only",
		icon: ClipboardList,
		note: "Change nothing at all: read, think, and propose a plan to approve.",
	},
	{
		/*
		 * A bolt rather than the sparkle the mockup drew. The sparkle is the model chip's
		 * icon and the two chips sit next to each other in the same row, so `auto` would
		 * have put the same glyph on both — and the one thing a 13px icon has to do there
		 * is tell you which chip you are looking at.
		 */
		mode: "auto",
		label: "auto",
		icon: Zap,
		note: "Stop asking altogether and decide for itself.",
	},
];

/** The mode's own word, for anywhere outside this menu that needs to say it. */
export function modeLabel(mode: AgentMode | undefined): string {
	return MODES.find((entry) => entry.mode === mode)?.label ?? MODES[0]!.label;
}

/**
 * Button two of three, inside the box: the mode chip and its menu.
 *
 * Left of the model, because it is the larger of the two decisions — what the agent may do
 * at all, rather than which one is doing it.
 */
export function ModeMenu(props: {
	/** The modes this agent's runtime actually offers. Empty for Pi, where permissions are
	 *  an extension's business, and the control is absent rather than present and inert. */
	modes: AgentMode[];
	mode: AgentMode | undefined;
	onMode: (mode: AgentMode) => void;
	disabled?: boolean;
}) {
	const available = () => MODES.filter((entry) => props.modes.includes(entry.mode));
	const current = () => MODES.find((entry) => entry.mode === props.mode) ?? available()[0] ?? MODES[0]!;

	/*
	 * How a row closes the menu it was picked from.
	 *
	 * `Popover` hands its `toggle` to the trigger and to nobody else, which is right — the
	 * card's content should not be able to reposition or reopen it — but a menu that stays
	 * up after it has been answered is a menu you then have to dismiss. So the handle is
	 * kept from the one call that is given it. The same three lines are in `ModelPicker`
	 * and `ContextDial`, for the same reason.
	 */
	let dismiss: (() => void) | undefined;

	return (
		/*
		 * More than one, not more than none. A runtime with a single mode has nothing to
		 * pick between, and a chip whose menu contains one row already ticked is a control
		 * that costs a glance every time and can never answer differently.
		 */
		<Show when={available().length > 1}>
			<Popover
				placement="top-start"
				class="w-[min(320px,calc(100vw-16px))]"
				label="How much this agent asks before acting"
				trigger={(api) => {
					dismiss = () => {
						if (api.open) api.toggle();
					};
					return (
					<button
						ref={api.ref}
						/*
						 * This chip does not give ground — until there is nothing else left to take.
						 *
						 * `dock.css` lets both chips in this row shrink, so a long model name can no
						 * longer push the send button out of the box. But flex shares a shortfall out
						 * in proportion, and a proportion of a shortfall is a *fraction of a pixel*:
						 * with the model chip set to absorb a hundred times its share, this one was
						 * still left 0.08px short of its own text on a 390px phone — and 0.08px is
						 * not 0.08px of text, because the browser drops whole glyphs to make room for
						 * an ellipsis. "edit freely" came out "edit fre…" for a rounding error.
						 *
						 * So above 380px it is rigid and the model name is the only thing that
						 * shortens, which is the right order anyway: the mode is two short words and
						 * the words are its whole value. Below 380px it becomes flexible again,
						 * because on a screen that narrow an ellipsis is a better outcome than a
						 * control pushed off the edge — and the label's own cap keeps its worst case
						 * knowable whatever a runtime decides to call a mode.
						 */
						class="chipbtn min-w-0 shrink-0 max-[380px]:shrink"
						type="button"
						/* Anything but `ask first` is a standing change to how the session behaves,
						   so it is tinted rather than merely labelled — you should be able to see
						   that an agent is in plan mode without stopping to read the word. */
						data-on={props.mode !== undefined && props.mode !== "manual"}
						disabled={props.disabled}
						aria-haspopup="menu"
						aria-expanded={api.open}
						title={current().note}
						onClick={api.toggle}
					>
						<Icon of={current().icon} size={13} />
						{/* 132px, about twenty characters: "bypass permissions" is eighteen. A mode
						    name comes from the runtime, so the cap is what makes the width of this
						    chip a thing the row can count on. */}
						<span class="max-w-[132px] truncate">{current().label}</span>
						<Icon of={ChevronDown} size={10} class="chev" />
					</button>
					);
				}}
			>
				<For each={available()}>
					{(entry) => (
						<button
							data-row
							data-current={entry.mode === props.mode}
							type="button"
							role="menuitemradio"
							aria-checked={entry.mode === props.mode}
							onClick={() => {
								props.onMode(entry.mode);
								dismiss?.();
							}}
						>
							<Icon of={entry.icon} size={14} class="ic" />
							<span class="lb">
								{entry.label}
								<Show when={entry.mode === props.mode}>
									<Icon of={Check} size={11} class="text-accent" />
								</Show>
							</span>
							<span class="nt">{entry.note}</span>
						</button>
					)}
				</For>
			</Popover>
		</Show>
	);
}
