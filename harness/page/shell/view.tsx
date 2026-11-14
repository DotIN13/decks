import ChevronLeft from "lucide-solid/icons/chevron-left";
import { Show, type JSX } from "solid-js";
import { Icon } from "@decks/ui";
import { ChatSection, FocusedStream, StatusPill } from "../chat/index.ts";
import { Composer, pageKey } from "../composer/index.ts";
import { abortAgent, answerAgent, closeAgent, focusAgent, moveAgentTo, newAgent, queueAction, renameAgent, setAgentMode, setAgentModel, setAgentThinking, tagAgent } from "../agents/actions.ts";
import { Dialog } from "../agents/index.ts";
import { CanvasHost, type CanvasHostInputs } from "../app/canvas-host.tsx";
import { moreItems } from "../app/more-menu.ts";
import { destination, destinationLabel } from "../app/send-from-bar.ts";
import { copyShared, deleteCanvas, moveConversation, newCanvas, openCanvas, renameCanvas, setStagesOpen, stagesOpen } from "../canvases/actions.ts";
import { CanvasManager } from "../canvases/CanvasManager.tsx";
import { CanvasOps } from "../canvases/CanvasOps.tsx";
import { CanvasSwitcher } from "../canvases/CanvasSwitcher.tsx";
import { can } from "../connections/backend.ts";
import { FilePicker } from "../files/index.ts";
import { scheme } from "../lib/theme.ts";
import { LeftPanel } from "../panel/LeftPanel.tsx";
import { FpsMeter, showFps } from "../perf/fps.tsx";
import { addAccount, forgetAccount, openSettings, readAccounts, repairTab, stopTab, useAccount } from "../settings/actions.ts";
import { Settings, UsageModal } from "../settings/index.ts";
import { camera } from "../state/camera.ts";
import { stageOf, stages } from "../state/canvases.ts";
import { removeComment, waitingComments } from "../state/comments.ts";
import { clearDialog, dialog, runtimeFor, state } from "../state/deck.ts";
import { editDrawing } from "../state/decks.ts";
import { queuedFor } from "../state/queued.ts";
import { selected } from "../state/selection.ts";
import { draft, openUsage, ops, panelOpen, pagesStarted, picking, readUsage, setDraft, setOps, setPanelOpen, settings, setSettings, setUsagePanel, unread, usagePanel, usageReport } from "../state/ui.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { NoticeStrip } from "./NoticeStrip.tsx";
import { TopBar } from "./TopBar.tsx";
import { TopRight } from "./TopRight.tsx";
import { createPage, type PageWiring } from "./actions.ts";

// The shell: the canvas, the panels floating over it, and the dock. Each piece
// below is the markup App.tsx drew, unchanged, handed the page's wiring.

type P = { page: PageWiring };
type Trigger = (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => JSX.Element;

const canvasMenu = (trigger: Trigger, placement: "bottom-start" | "bottom-end" = "bottom-start") => (
	<CanvasSwitcher stages={stages()} here={stageOf(state.focused)?.name} scheme={scheme()} placement={placement} onPick={openCanvas} onNew={() => newCanvas()} onAll={() => void setStagesOpen(true)} trigger={trigger} />
);

const usageOf = () => (state.focused ? state.agents[state.focused]?.usage : undefined);

function Top(props: P): JSX.Element {
	const page = props.page;
	const phone = () => page.layout.phone();
	const here = () => stageOf(state.focused);
	return (
		<>
			<TopBar
				panelOpen={panelOpen() && !phone()}
				desktop={!phone()}
				onTogglePanel={() => setPanelOpen(!panelOpen())}
				chats={state.chats}
				identities={state.identities}
				focused={state.focused}
				unread={unread}
				onFocus={focusAgent}
				onNew={(kind) => void newAgent({ ...(kind ? { kind } : {}) })}
				onClose={closeAgent}
				onMoreAgents={page.openAgentsPanel}
				phone={phone()}
				onNewCanvas={() => newCanvas()}
				{...(here() ? { stage: here()!.title } : {})}
				{...(stages().length > 0 ? { onStages: () => void setStagesOpen((was) => !was), stagesOpen: stagesOpen() } : {})}
				{...(!phone() && stages().length > 0 ? { canvasMenu: (trigger: Trigger) => canvasMenu(trigger) } : {})}
				{...(page.viewOnlyStage() ? { viewOnly: page.viewOnlyStage()!.shared!.owner, onCopy: () => copyShared(page.viewOnlyStage()!.name) } : {})}
			/>
			<CanvasManager stages={stages()} onRename={renameCanvas} onDelete={deleteCanvas} onCopy={copyShared} here={here()?.name} open={stagesOpen()} onClose={() => void setStagesOpen(false)} onPick={openCanvas} onNew={(title) => newCanvas(title)} scheme={scheme()} />
			<Show when={!phone()} fallback={<span class="v3-phone-more"><TopRight menuOnly here={[]} identities={state.identities} unread={unread} focused={state.focused} onFocus={focusAgent} onPresent={page.presenting.present} usage={usageOf()} onContext={() => openUsage(state.focused)} more={moreItems(page.stagePages)} /></span>}>
				<TopRight here={page.hereAgents()} identities={state.identities} unread={unread} focused={state.focused} onFocus={focusAgent} onPresent={page.presenting.present} usage={usageOf()} onContext={() => openUsage(state.focused)} more={moreItems(page.stagePages)} />
				<Show when={showFps()}>
					<FpsMeter />
				</Show>
			</Show>
		</>
	);
}

function Overlays(props: P): JSX.Element {
	return (
		<>
			<Show when={ops()}>
				<CanvasOps onClose={() => setOps(false)} />
			</Show>
			<ConfirmDialog />
			<Show when={picking()}>
				{(request) => (
					<FilePicker
						onPick={(path) => request().resolve(path)}
						onCancel={() => request().resolve(undefined)}
						onAdd={(file) => props.page.files.addFile(file)}
						purpose={request().purpose ?? "embed"}
						{...(request().google ? { onGoogle: (url: string) => request().resolve(`google:${url}`) } : {})}
					/>
				)}
			</Show>
		</>
	);
}

function Chat(props: P & { sheet?: boolean }): JSX.Element {
	const page = props.page;
	const layout = page.layout;
	return (
		<ChatSection
			chat={page.focusedChat()}
			identity={state.identities[state.focused ?? ""]}
			unread={state.focused ? (unread[state.focused] ?? 0) : 0}
			folded={props.sheet ? false : layout.chatFolded()}
			onFold={(folded: boolean, gone?: unknown) => (props.sheet ? (folded ? layout.setPhoneChat(false, undefined, gone as never) : undefined) : (layout.setChatFolded(folded), layout.holdHistory()))}
			{...(props.sheet ? { from: layout.sheetFrom(), leaving: layout.sheetLeaving(), sheet: true } : {})}
		>
			<FocusedStream shown={layout.chatShown()} items={page.transcript()} chat={page.focusedChat()} atTurn={page.atTurn()} />
		</ChatSection>
	);
}

function Panel(props: P): JSX.Element {
	const page = props.page;
	const here = () => stageOf(state.focused);
	return (
		<LeftPanel
			{...(page.panelAsk() ? { ask: page.panelAsk()! } : {})}
			boards={state.pages}
			{...(page.stagePen()?.doc ? { canvasDoc: page.stagePen()!.doc as never } : {})}
			{...(here() ? { canvasTitle: here()!.title } : {})}
			selectedItems={page.penSelected()}
			onPickItem={page.pills.pickItem}
			onCanvases={() => void setStagesOpen((was) => !was)}
			{...(stages().length > 0 ? { canvasMenu: (trigger: Trigger) => canvasMenu(trigger) } : {})}
			onPickArrows={(ids) => {
				page.editorHandle()?.select(ids);
				page.setPenSelected(ids);
			}}
			desktop={!page.layout.phone()}
			onSettings={openSettings}
			pens={state.deck?.pens ?? []}
			onPlacePen={(pen) => state.focused && void editDrawing(state.focused, [{ op: "insert", node: { type: "ref", ref: pen.ref }, box: { x1: Math.round(camera().x), y1: Math.round(camera().y) } }])}
			listMayGrow={pagesStarted()}
			current={selected()}
			inPlay={page.stagePages().map((card) => card.path)}
			kept={state.focused ? (state.contexts[state.focused] ?? []) : []}
			focused={state.focused}
			open={panelOpen()}
			onOpenChange={setPanelOpen}
			findAt={page.findAt()}
			chats={state.chats}
			identities={state.identities}
			unread={unread}
			onFocusAgent={focusAgent}
			onNewAgent={(workspace, kind) => void newAgent({ ...(kind ? { kind } : {}), ...(workspace ? { workspace } : {}) })}
			onCloseAgent={closeAgent}
			onAgentTags={tagAgent}
			onAgentWorkspace={moveAgentTo}
			onAgentRename={renameAgent}
			onAbortAgent={abortAgent}
			apps={page.apps.apps()}
			onAppsOpen={page.apps.loadApps}
			onApp={page.apps.onApp}
			onAppLogs={page.apps.onAppLogs}
			chat={
				<Show when={!page.layout.phone()}>
					<Chat page={page} />
				</Show>
			}
		/>
	);
}

function Modals(props: P): JSX.Element {
	return (
		<>
			<Show when={usagePanel() && usagePanel() === state.focused}>
				<UsageModal usage={usageOf()} report={usageReport().report} error={usageReport().error} loading={usageReport().loading} at={usageReport().at} onRefresh={() => readUsage(state.focused)} onClose={() => setUsagePanel(undefined)} />
			</Show>
			<Show when={settings()}>
				<Settings prefs={props.page.prefs()} onPrefs={props.page.setPrefs} accounts={state.accounts} active={state.activeAccount} onAdd={addAccount} onForget={forgetAccount} web={state.web} onWebRepair={() => void repairTab()} onWebStop={stopTab} phone={props.page.layout.phone()} onClose={() => setSettings(false)} />
			</Show>
		</>
	);
}

function DockedComposer(props: P): JSX.Element {
	const page = props.page;
	const id = () => state.focused ?? "";
	const chat = () => page.focusedChat();
	const runtime = () => runtimeFor(chat()?.kind);
	const dest = () => destination(page.bar.barText(), page.bar.barContext());
	const canvas = () => stageOf(state.focused)?.name;
	return (
		<Composer
			draft={draft()}
			agentId={state.focused}
			page={pageKey(state.focused, canvas())}
			usage={usageOf()}
			onUsage={() => openUsage(state.focused)}
			busy={page.busy()}
			model={state.focused ? state.agents[state.focused]?.model : undefined}
			models={runtime()?.models ?? []}
			commands={chat()?.commands ?? runtime()?.commands ?? []}
			runtime={chat()?.kind}
			modes={runtime()?.capabilities?.modes ?? []}
			mode={chat()?.mode}
			onMode={(mode) => setAgentMode(id(), mode)}
			onSend={(text, comments, draft) => page.bar.sendFromBar(text, comments, false, draft)}
			onQueue={(text, comments, draft) => page.bar.sendFromBar(text, comments, true, draft)}
			{...(queuedFor(state.focused) ? { queued: queuedFor(state.focused)! } : {})}
			onQueueAction={(action, item) => state.focused && queueAction(state.focused, action, item)}
			comments={waitingComments(state.focused, canvas())}
			onCommentsGone={(ids) => ids.forEach((one) => state.focused && removeComment(state.focused, canvas(), one))}
			onText={page.bar.setBarText}
			destination={destinationLabel(dest())}
			recipient={{ chats: state.chats, identities: state.identities, unread, focused: state.focused, dest: dest(), label: destinationLabel(dest()), onPick: focusAgent, onNew: (kind) => void newAgent({ ...(kind ? { kind } : {}) }), onClose: closeAgent, onMore: page.openAgentsPanel }}
			mentionables={state.chats.map((one) => ({ name: page.bar.agentName(one.id), chat: one }))}
			onAbort={() => abortAgent(id())}
			onModel={(provider, model, thinking) => setAgentModel(id(), provider, model, thinking)}
			onThinking={(thinking) => setAgentThinking(id(), thinking)}
			{...(chat()?.kind === "claude" && state.accounts.length > 1 ? { accounts: state.accounts } : {})}
			account={(state.focused ? state.agents[state.focused]?.spending : undefined) ?? state.activeAccount}
			onAccount={(account: string) => useAccount(account, id())}
			onAccountsOpen={readAccounts}
			onAttach={() => {
				const agentId = state.focused;
				void page.pickFile().then((path) => path && setDraft({ text: "", files: [path], at: Date.now(), insert: true, ...(agentId ? { agentId } : {}) }));
			}}
			onDraftTaken={() => setDraft(undefined)}
			onDropFiles={(files) => void page.files.intoComposer(files)}
			titleOf={page.pills.titleOf}
			itemName={page.pills.itemName}
			onShowPill={page.pills.showPill}
		/>
	);
}

function Dock(props: P): JSX.Element {
	const page = props.page;
	return (
		<div class="dock" ref={page.dock.watchDock} data-under={page.underSheet() ? "true" : undefined}>
			<button type="button" class="stowtab" data-stowtab aria-label="Bring the input bar back" title="Bring the input bar back" onClick={() => page.dock.unstow()}>
				<Icon of={ChevronLeft} size={16} />
			</button>
			<Show when={dialog()}>
				{(prompt) => (
					<Dialog
						prompt={prompt()}
						onAnswer={(answer) => {
							if (state.focused) answerAgent(state.focused, prompt().id, answer);
							clearDialog();
						}}
					/>
				)}
			</Show>
			<Show when={!page.layout.chatShown() && (page.layout.phone() || !panelOpen())}>
				<StatusPill chat={page.focusedChat()} identity={state.identities[state.focused ?? ""]} onOpen={page.layout.openChat} />
			</Show>
			<DockedComposer page={page} />
		</div>
	);
}

/** The inputs the canvas host takes from the wiring. */
const hostOf = (page: PageWiring): CanvasHostInputs => ({
	stagePen: page.stagePen as never,
	personMoved: page.landing.personMoved,
	setPenSelected: page.setPenSelected,
	setEditorHandle: page.setEditorHandle,
	dockCover: page.dock.dockCover,
	composerBox: page.dock.composerBox,
	underSheet: page.setUnderSheet,
	openAppsPanel: page.openAppsPanel,
	files: page.files,
	frameWhenPlaced: page.frameWhenPlaced,
	moveConversation,
});

/** The page. */
export function Shell(): JSX.Element {
	const page = createPage();
	return (
		<div class="app" data-presenting={page.presenting.presenting() ? "true" : undefined} data-phone={page.layout.phone() ? "true" : undefined} data-reader={can("write") ? undefined : ""}>
			<div class="work">
				<div class="surface" data-surface="stage">
					<div class="surface-layer" data-layer="stage">
						<CanvasHost host={hostOf(page)} />
					</div>
				</div>
				<Top page={page} />
				<Overlays page={page} />
				<Panel page={page} />
				<Show when={page.layout.phone() && page.layout.phoneChat()}>
					<Chat page={page} sheet />
				</Show>
				<Modals page={page} />
				<Dock page={page} />
				<NoticeStrip />
			</div>
		</div>
	);
}
