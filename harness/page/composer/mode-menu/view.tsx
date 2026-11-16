import type { AgentMode } from "@decks/protocol";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ClipboardList from "lucide-solid/icons/clipboard-list";
import Shield from "lucide-solid/icons/shield";
import SquarePen from "lucide-solid/icons/square-pen";
import Zap from "lucide-solid/icons/zap";
import type { LucideIcon } from "lucide-solid";
import { For, Show } from "solid-js";
import { Icon, Popover } from "@decks/ui";
import { pickMode } from "./actions.ts";
import { availableModes, currentMode, modeTinted, type ModeEntry } from "./model.ts";

// The mode chip and its menu, inside the box.

/** Button two of three, inside the box: the mode chip and its menu. */
export function ModeMenu(props: {
	/** The modes this agent's runtime actually offers. Empty for Pi, where permissions are
	 *  an extension's business, and the control is absent rather than present and inert. */
	modes: AgentMode[];
	mode: AgentMode | undefined;
	onMode: (mode: AgentMode) => void;
	disabled?: boolean;
}) {
	const available = () => availableModes(props.modes);
	const current = () => currentMode(props.modes, props.mode);

	/* How a row closes the menu it was picked from. */
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
				class="w-[min(220px,calc(100vw-16px))]"
				label="How much this agent asks before acting"
				trigger={(api) => {
					dismiss = () => {
						if (api.open) api.toggle();
					};
					return (
					<button
						ref={api.ref}
						/* This chip does not give ground, until there is nothing else left to take. */
						class="chip-button min-w-0 shrink-0" data-mode-chip
						type="button"
						/* Anything but `ask first` is a standing change to how the session behaves,
						   so it is tinted rather than merely labelled, you should be able to see
						   that an agent is in plan mode without stopping to read the word. */
						data-on={modeTinted(props.mode)}
						disabled={props.disabled}
						aria-haspopup="menu"
						aria-expanded={api.open}
						title={current().note}
						onClick={api.toggle}
					>
						<Icon of={ICONS[current().mode]} size={13} />
						{/* 132px, about twenty characters: "bypass permissions" is eighteen. A mode
						    name comes from the runtime, so the cap is what makes the width of this
						    chip a thing the row can count on. */}
						<span class="max-w-[132px] truncate">{current().label}</span>
						<Icon of={ChevronDown} size={10} class="chevron" />
					</button>
					);
				}}
			>
				<For each={available()}>{(entry) => <ModeRow entry={entry} current={props.mode} onPick={(mode) => pickMode(mode, props.onMode, dismiss)} />}</For>
			</Popover>
		</Show>
	);
}

/** One mode in the menu: its name alone, the choice shown as its wash, the note as its tooltip. */
function ModeRow(props: { entry: ModeEntry; current: AgentMode | undefined; onPick: (mode: AgentMode) => void }) {
	return (
		<button
			data-row
			data-flat="true"
			title={props.entry.note}
			data-current={props.entry.mode === props.current}
			type="button"
			role="menuitemradio"
			aria-checked={props.entry.mode === props.current}
			onClick={() => props.onPick(props.entry.mode)}
		>
			<Icon of={ICONS[props.entry.mode]} size={15} class="row-icon" />
			<span class="row-label">{props.entry.label}</span>
		</button>
	);
}

/** Each mode's glyph. A bolt for auto, so it never wears the model chip's sparkle beside it. */
const ICONS: Record<AgentMode, LucideIcon> = { manual: Shield, acceptEdits: SquarePen, plan: ClipboardList, auto: Zap };
