/**
 * The dashboard: three panes under one tab strip, and a preview over all of it.
 *
 * Boards is the pane you land on — what is in flight, then every board as a picture.
 * Tasks is the record; Cron is what keeps making tasks. The strip (`DispatchTabs`) is three
 * pill buttons, the chosen one filled, with the ARIA tabs pattern (one tab stop, arrows within), and the
 * Boards tab carries the count of tasks that want a person, because that number is the
 * reason to come here at all. The view does not draw the strip itself: the top-left pill
 * does, where the agent selector is on a stage, so the chrome has one place for "which
 * view" on both surfaces.
 *
 * The surface owns no state but the search field and the folds inside the gallery:
 * which tab, which preview, and every action are the caller's, so the same view can be
 * driven from the bar, a URL, or a test.
 */
import type { AgentChat, Board, Canvas, Identity, Schedule, Task } from "@decks/protocol";
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { CronList } from "./CronList.tsx";
import { DISPATCH_TAB_LABEL, DISPATCH_TABS, type DispatchTab } from "./dispatch-view.ts";
import { CanvasShelf } from "./CanvasShelf.tsx";
import { Preview } from "./Preview.tsx";
import { TaskList } from "./TaskList.tsx";

export interface DispatchViewProps {
	tab: DispatchTab;
	onTab: (tab: DispatchTab) => void;
	boards: Board[];
	identities: Record<string, Identity>;
	/** Every canvas in the deck — the landing pane's cards. */
	canvases: Canvas[];
	/** Open a canvas: the press that leaves the dashboard, with the card it was pressed on. */
	onOpenCanvas: (canvas: Canvas, card: DOMRect) => void;
	/** Make one in a workspace (`undefined` for none), and go to it. */
	onNewCanvas: (workspace: string | undefined) => void;
	onRenameCanvas: (id: string, name: string) => void;
	/** File a canvas under a workspace, or under none with `null`. */
	onMoveCanvas: (id: string, workspace: string | null) => void;
	/** Remove the arrangement; the boards stay in the deck. */
	onRemoveCanvas: (id: string) => void;
	/** Every workspace in use, for the cards' move menu. */
	workspaces: string[];
	/** A new workspace, from the bar: its first canvas, filed under it and named after it. */
	onNewWorkspace: (name: string) => void;
	chats: AgentChat[];
	/** Agent id → the boards it holds — what decides a board's workspace. */
	contexts: Record<string, string[]>;
	tasks: Task[];
	schedules: Schedule[];
	/** The board path under preview, if one is. */
	preview?: string;
	onPreview: (path: string | undefined) => void;
	onOpenOnCanvas: (path: string) => void;
	onOpenAgent: (id: string) => void;
	onCancelTask: (id: string) => void;
	onRetryTask: (id: string) => void;
	onRunSchedule: (id: string) => void;
	onCancelSchedule: (id: string) => void;
	/** Open the conversation float on one task's dispatcher log, from its row. */
	onOpenLog: (dispatcherId: string) => void;
}

export interface DispatchTabsProps {
	tab: DispatchTab;
	onTab: (tab: DispatchTab) => void;
	/** The number on the Tasks tab, how many want a person; nothing is drawn for zero. */
	badge?: number;
}

/** The strip alone, for a caller that wants to place it elsewhere than over the panes. */
export function DispatchTabs(props: DispatchTabsProps) {
	const ids = createUniqueId();
	return (
		<div class="dispatch-tabs" role="tablist" aria-label="Dispatch">
			<For each={DISPATCH_TABS}>
				{(name) => (
					<button
						type="button"
						role="tab"
						id={`${ids}-tab-${name}`}
						aria-selected={props.tab === name}
						aria-controls={`${ids}-pane`}
						tabindex={props.tab === name ? 0 : -1}
						data-on={props.tab === name}
						onClick={() => props.onTab(name)}
						onKeyDown={(event) => {
							if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
							event.preventDefault();
							const at = DISPATCH_TABS.indexOf(name);
							const next = DISPATCH_TABS[(at + (event.key === "ArrowRight" ? 1 : -1) + DISPATCH_TABS.length) % DISPATCH_TABS.length]!;
							props.onTab(next);
							document.getElementById(`${ids}-tab-${next}`)?.focus();
						}}
					>
						{DISPATCH_TAB_LABEL[name]}
						<Show when={name === "tasks" && (props.badge ?? 0) > 0}>
							<span class="dispatch-badge" aria-label={`${props.badge} waiting on you`}>
								{props.badge}
							</span>
						</Show>
					</button>
				)}
			</For>
		</div>
	);
}

export function DispatchView(props: DispatchViewProps) {
	/** The task a gallery card's "from a task" chip asked to see; the Tasks tab scrolls to it and marks it. */
	const [spotTask, setSpotTask] = createSignal<string | undefined>();
	return (
		<section class="dispatch" aria-label="Dispatch" data-preview={props.preview ? "true" : undefined}>
			{/* The panes, in a column of their own so the preview can stand beside them. */}
			<div class="dispatch-side">
			<Show when={props.tab === "canvases"}>
				<div class="dispatch-pane dispatch-scroll" role="tabpanel" data-id="canvases">
					<CanvasShelf
						canvases={props.canvases}
						boards={props.boards}
						identities={props.identities}
						workspaces={props.workspaces}
						onOpen={props.onOpenCanvas}
						onCreate={props.onNewCanvas}
						onRename={props.onRenameCanvas}
						onMove={props.onMoveCanvas}
						onRemove={props.onRemoveCanvas}
						onNewWorkspace={props.onNewWorkspace}
					/>
				</div>
			</Show>
			<Show when={props.tab === "tasks"}>
				<div class="dispatch-pane dispatch-scroll" role="tabpanel" data-id="tasks">
					<TaskList
						tasks={props.tasks}
						chats={props.chats}
						boards={props.boards}
						spot={spotTask()}
						onOpenAgent={props.onOpenAgent}
						onCancelTask={props.onCancelTask}
						onRetryTask={props.onRetryTask}
						onOpenLog={props.onOpenLog}
						onPreview={(path) => props.onPreview(path)}
					/>
				</div>
			</Show>
			<Show when={props.tab === "cron"}>
				<div class="dispatch-pane dispatch-scroll" role="tabpanel" data-id="cron">
					<CronList schedules={props.schedules} boards={props.boards} onRunSchedule={props.onRunSchedule} onCancelSchedule={props.onCancelSchedule} onPreview={(path) => props.onPreview(path)} />
				</div>
			</Show>
			</div>
			<Show when={props.preview}>
				{(path) => (
					<Preview
						path={path()}
						boards={props.boards}
						identities={props.identities}
						contexts={props.contexts}
						onOpenOnCanvas={props.onOpenOnCanvas}
						onClose={() => props.onPreview(undefined)}
					/>
				)}
			</Show>
		</section>
	);
}
