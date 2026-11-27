import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Folder from "lucide-solid/icons/folder";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { AgentKind } from "@decks/protocol";
import { Icon } from "@decks/ui";
import { m } from "@decks/i18n";
import { NewAgentButton } from "../agents/AgentPill.tsx";
import type { AgentSection } from "../agents/agent-sections.ts";
import { carriesAgent, draggedAgent } from "../agents/agent-drag.ts";
import { ListedAgent, type ListedAgents } from "./agent-list.tsx";

/**
 * The side panel's Agents tab: the agents filed by workspace (`agent-sections.ts`), each workspace a
 * folder that folds shut and takes a dragged agent, with a `+` to make one in it.
 *
 * Mounted once by the panel and drawn only while `shown`, so the folders it has folded and the
 * heading a drag is over last across a visit to another tab.
 */
export function AgentsTab(props: {
	shown: boolean;
	/** The sections, already filtered by the search (`createAgentLists`). */
	sections: AgentSection[];
	agents: ListedAgents;
	/** How many of the section at `index`'s rows may be drawn yet: the panel's row budget. */
	allowance: (index: number) => number;
	/** Every agent, unfiltered, for the empty state's words. */
	agentCount: number;
	query: string;
	/** Make an agent in a workspace (`undefined` for none) — the `+` on a heading of the workspace cut. */
	onNewAgent?: (workspace: string | undefined, kind: AgentKind) => void;
}) {
	const calls = props.agents.calls;
	/* Workspace folders folded shut, remembered on this device. */
	const [folded, setFolded] = createSignal<Set<string>>(readFolded());
	const toggleFolder = (id: string) => {
		const next = new Set(folded());
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setFolded(next);
		try {
			localStorage.setItem(FOLDED_KEY, JSON.stringify([...next]));
		} catch {
			// Kept for the session.
		}
	};

	/** The section a dragged agent is over, by its id, so the heading it would land under says so. */
	const [over, setOver] = createSignal<string | undefined>(undefined);
	/*
	 * However a drag ends — dropped here, dropped elsewhere, or abandoned with Escape — no
	 * heading is under it any more. On the window because `dragend` fires on the row that was
	 * picked up, which is not the section that marked itself.
	 */
	onMount(() => {
		const done = () => setOver(undefined);
		window.addEventListener("dragend", done);
		window.addEventListener("drop", done);
		onCleanup(() => {
			window.removeEventListener("dragend", done);
			window.removeEventListener("drop", done);
		});
	});

	return (
		<Show when={props.shown}>
			<For each={props.sections}>
				{(section, index) => (
					<div
						class="panel-section"
						data-kind={section.kind}
						/*
						 * A heading is where an agent is dropped to change the project it says it is
						 * in (`agents/agent-drag.ts`). The whole section takes the drop, not the
						 * heading's own line: the target you aim at is the group of rows, and a 20px
						 * strip of text is a target you miss.
						 *
						 * `preventDefault` on `dragover` is what makes a drop possible at all, and
						 * saying it only for our own type is what keeps a file dragged in from
						 * landing here instead of on the canvas.
						 */
						data-drop={over() === section.id ? "true" : undefined}
						onDragOver={(event) => {
							if (!calls.onAgentWorkspace || !carriesAgent(event.dataTransfer)) return;
							event.preventDefault();
							if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
							setOver(section.id);
						}}
						onDragLeave={(event) => {
							/*
							 * Only when the pointer left this section for somewhere we can name.
							 * Crossing a row inside it fires this too — hence the containment test —
							 * and a `dragleave` with no `relatedTarget` at all is the browser's way of
							 * saying "somewhere else", which during a drag over our own list is
							 * usually a frame boundary rather than a departure. Clearing on those left
							 * the heading unmarked while the hand held still over it. The end of the
							 * drag clears it whatever happens (above).
							 */
							const to = event.relatedTarget as Node | null;
							if (!to || event.currentTarget.contains(to)) return;
							setOver((was) => (was === section.id ? undefined : was));
						}}
						onDrop={(event) => {
							const id = draggedAgent(event.dataTransfer);
							setOver(undefined);
							if (!id) return;
							event.preventDefault();
							calls.onAgentWorkspace?.(id, section.kind === "workspace" ? section.label : null);
						}}
					>
						<div class="v3-folder-head" data-folded={folded().has(section.id) ? "true" : undefined}>
							<button type="button" class="v3-folder-toggle" aria-expanded={!folded().has(section.id)} title={folded().has(section.id) ? m.panel_folder_show({ name: section.label }) : m.panel_folder_fold({ name: section.label })} onClick={() => toggleFolder(section.id)}>
								<Icon of={folded().has(section.id) ? ChevronRight : ChevronDown} size={13} class="v3-folder-chev" />
								<Icon of={Folder} size={15} class="v3-folder-icon" />
								<span class="v3-folder-name truncate">{section.label}</span>
							</button>
							<Show when={section.note}>{(note) => <span class="note">{note()}</span>}</Show>
							<Show when={props.onNewAgent}>
								<NewAgentButton
									onNew={(kind) => props.onNewAgent?.(section.kind === "workspace" ? section.label : undefined, kind)}
									label={section.kind === "workspace" ? m.panel_add_agent_in({ name: section.label }) : m.panel_add_agent_none()}
									class="v3-folder-add"
									size={14}
								/>
							</Show>
						</div>
						{/*
							`.row-list` is the row vocabulary — the grid, the corner, the hover, the
							current wash, `.row-act` and its ×, and the `.row-label`/`.row-note` type scale. The
							agent row wants all of that and its own overrides (a 20px or 26px face column,
							by `data-lines`), which `.agent-list` in `panel.css` supplies.

							Re-implementing it instead is how two lists in one panel come to nearly
							match: the card rows above are the same object.
						*/}
						{/* Folded by its height (`styles/v3.css`), so the rows slide shut rather than vanish. */}
						<div class="v3-folder-body" data-open={folded().has(section.id) ? "false" : "true"} aria-hidden={folded().has(section.id)}>
							<div class="row-list agent-list" data-lines={props.agents.lines()}>
								<For each={section.rows.slice(0, props.allowance(index()))}>{(row) => <ListedAgent row={row} size={22} with={props.agents} />}</For>
							</div>
						</div>
					</div>
				)}
			</For>
			<Show when={props.onNewAgent}>
				<NewAgentButton onNew={(kind) => props.onNewAgent?.(undefined, kind)} label={m.panel_new_agent()} class="v3-new-agent" size={15} text={m.panel_new_agent()} />
			</Show>

			{/* The same shape of empty state the cards list has, and the same reasoning:
			    a panel that is blank for a good reason still looks broken without it. */}
			<Show when={props.sections.length === 0}>
				<p class="m-0 px-1 py-2 text-ui leading-normal text-faint">{props.agentCount === 0 ? m.panel_no_agents_start() : m.panel_no_agent_matches({ query: props.query.trim() })}</p>
			</Show>
		</Show>
	);
}

const FOLDED_KEY = "decks.foldedWorkspaces";

/** The workspace folders folded shut on this device. */
function readFolded(): Set<string> {
	try {
		const raw = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]");
		return new Set(Array.isArray(raw) ? raw.filter((one): one is string => typeof one === "string") : []);
	} catch {
		return new Set();
	}
}
