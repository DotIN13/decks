import { For, Show } from "solid-js";
import { m } from "@decks/i18n";
import type { AgentRow as AgentListRow } from "../agents/agent-sections.ts";
import { ListedAgent, type ListedAgents } from "./agent-list.tsx";

/**
 * The side panel's Recent tab: every agent in one list, the latest first (`recentAgents`), with no
 * workspace folders between them.
 *
 * Mounted once by the panel and drawn only while `shown`, as the other tabs are.
 */
export function RecentTab(props: {
	shown: boolean;
	/** The rows, already filtered by the search (`createAgentLists`). */
	rows: AgentListRow[];
	agents: ListedAgents;
	/** Every agent, unfiltered, for the empty state's words. */
	agentCount: number;
	query: string;
}) {
	return (
		<Show when={props.shown}>
			<div class="panel-section" data-kind="recent">
				<Show when={props.rows.length > 0}>
					<div class="v3-sec">
						<span>{m.panel_tab_recent()}</span>
					</div>
				</Show>
				<div class="row-list agent-list" data-lines={props.agents.lines()}>
					<For each={props.rows}>{(row) => <ListedAgent row={row} size={26} with={props.agents} />}</For>
				</div>
			</div>
			<Show when={props.rows.length === 0}>
				<p class="m-0 px-1 py-2 text-ui leading-normal text-faint">{props.agentCount === 0 ? m.panel_no_agents() : m.panel_no_agent_matches({ query: props.query.trim() })}</p>
			</Show>
		</Show>
	);
}
