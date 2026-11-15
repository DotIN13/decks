import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Folder from "lucide-solid/icons/folder";
import { For, Show, type JSX } from "solid-js";
import { Icon } from "@decks/ui";
import type { AgentRow as Row, AgentSection } from "../../agents/agent-sections.ts";
import { AgentRow } from "../../agents/AgentRow.tsx";
import { NewAgentButton } from "../../agents/face/view.tsx";
import type { AgentKind, Identity } from "../../state/types/index.ts";
import { dropOn } from "./actions.ts";
import { addWords, noAgentsWords, workspaceOf } from "./model.ts";

// The side panel's Agents list (agents in folders by workspace, each folder
// foldable and a drop target) and its Recent list, sharing one agent row.

export type Lists = {
	identities: Record<string, Identity> | undefined;
	workspaces: string[];
	lines: 1 | 2;
	count: number;
	query: string;
	taken: (name: string, self: string) => boolean;
	hover: (id: string, at: DOMRect | undefined) => void;
	onFocusAgent?: (id: string) => void;
	onCloseAgent?: (id: string) => void;
	onNewAgent?: (workspace: string | undefined, kind: AgentKind) => void;
	onAgentTags?: (id: string, tags: string[]) => void;
	onAgentWorkspace?: (id: string, workspace: string | null) => void;
	onAgentRename?: (id: string, name: string) => void;
	onAbortAgent?: (id: string) => void;
};

function PanelRow(p: { row: Row; l: Lists; size: number }): JSX.Element {
	const { l } = p;
	const id = () => p.row.chat.id;
	return (
		<AgentRow
			row={p.row}
			identity={l.identities?.[id()]}
			onFocus={() => l.onFocusAgent?.(id())}
			onClose={() => l.onCloseAgent?.(id())}
			{...(l.onAgentTags ? { onTags: (tags: string[]) => l.onAgentTags?.(id(), tags) } : {})}
			workspaces={l.workspaces}
			{...(l.onAgentWorkspace ? { onWorkspace: (workspace: string | null) => l.onAgentWorkspace?.(id(), workspace) } : {})}
			{...(l.onAgentRename ? { onRename: (name: string) => l.onAgentRename?.(id(), name) } : {})}
			taken={(name) => l.taken(name, id())}
			{...(l.onAbortAgent ? { onAbort: () => l.onAbortAgent?.(id()) } : {})}
			lines={l.lines}
			size={p.size}
			onHover={(at) => l.hover(id(), at)}
		/>
	);
}

type Folders = { folded: () => Set<string>; toggle: (id: string) => void; over: () => string | undefined; setOver: (fn: (was: string | undefined) => string | undefined) => void; allowance: (index: number) => number };

function FolderHead(p: { section: AgentSection; l: Lists; f: Folders }): JSX.Element {
	const shut = () => p.f.folded().has(p.section.id);
	return (
		<div class="v3-folder-head" data-folded={shut() ? "true" : undefined}>
			<button type="button" class="v3-folder-toggle" aria-expanded={!shut()} title={shut() ? `Show ${p.section.label}` : `Fold ${p.section.label}`} onClick={() => p.f.toggle(p.section.id)}>
				<Icon of={shut() ? ChevronRight : ChevronDown} size={13} class="v3-folder-chev" />
				<Icon of={Folder} size={15} class="v3-folder-icon" />
				<span class="v3-folder-name truncate">{p.section.label}</span>
			</button>
			<Show when={p.section.note}>{(note) => <span class="note">{note()}</span>}</Show>
			<Show when={p.l.onNewAgent}>
				<NewAgentButton onNew={(kind) => p.l.onNewAgent?.(workspaceOf(p.section) ?? undefined, kind)} label={addWords(p.section)} class="v3-folder-add" size={14} />
			</Show>
		</div>
	);
}

export function AgentsTab(props: { sections: AgentSection[]; l: Lists; f: Folders }): JSX.Element {
	return (
		<>
			<For each={props.sections}>
				{(section, index) => (
					<div class="panel-section" data-kind={section.kind} data-drop={props.f.over() === section.id ? "true" : undefined} {...dropOn(section, workspaceOf(section), { set: props.f.setOver }, props.l.onAgentWorkspace)}>
						<FolderHead section={section} l={props.l} f={props.f} />
						<div class="v3-folder-body" data-open={props.f.folded().has(section.id) ? "false" : "true"} aria-hidden={props.f.folded().has(section.id)}>
							<div class="row-list agent-list" data-lines={props.l.lines}>
								<For each={section.rows.slice(0, props.f.allowance(index()))}>{(row) => <PanelRow row={row} l={props.l} size={22} />}</For>
							</div>
						</div>
					</div>
				)}
			</For>
			<Show when={props.l.onNewAgent}>
				<NewAgentButton onNew={(kind) => props.l.onNewAgent?.(undefined, kind)} label="New agent" class="v3-new-agent" size={15} text="New agent" />
			</Show>
			<Show when={props.sections.length === 0}>
				<p class="m-0 px-1 py-2 text-ui leading-normal text-faint">{noAgentsWords(props.l.count, props.l.query, false)}</p>
			</Show>
		</>
	);
}

export function RecentTab(props: { rows: Row[]; l: Lists }): JSX.Element {
	return (
		<>
			<div class="panel-section" data-kind="recent">
				<Show when={props.rows.length > 0}>
					<div class="v3-sec">
						<span>Recent</span>
					</div>
				</Show>
				<div class="row-list agent-list" data-lines={props.l.lines}>
					<For each={props.rows}>{(row) => <PanelRow row={row} l={props.l} size={26} />}</For>
				</div>
			</div>
			<Show when={props.rows.length === 0}>
				<p class="m-0 px-1 py-2 text-ui leading-normal text-faint">{noAgentsWords(props.l.count, props.l.query, true)}</p>
			</Show>
		</>
	);
}
