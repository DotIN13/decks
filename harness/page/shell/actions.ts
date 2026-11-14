import { createComputed, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { FramedHandle } from "@decks/canvas";
import { drawing, setDrawing } from "@decks/canvas/tools";
import { watchInsets } from "@decks/canvas/camera";
import { closeHistory, createChatLayout, createPresenting, forgetAskedResults, receiveToolResult, setToolResultSender } from "../chat/index.ts";
import { focusAgent } from "../agents/actions.ts";
import { syncRings } from "../agents/ring-sync.ts";
import { createAlerts } from "../app/alerts.ts";
import { createAppsPanel } from "../app/apps-panel.ts";
import { createBar } from "../app/bar.ts";
import { createDock } from "../app/dock.ts";
import { createFloats } from "../app/floats.ts";
import { setCommentSender } from "../app/frame-handoffs.ts";
import { installKeys } from "../app/keys.ts";
import { createCameraLanding, reportCameraOnArrival } from "../app/landing.ts";
import { createFraming } from "../app/links.ts";
import { createPills } from "../app/pills.ts";
import { installViewport } from "../app/viewport.ts";
import { can } from "../connections/backend.ts";
import { createFileDrops } from "../files/index.ts";
import { scheme } from "../lib/theme.ts";
import type { PanelTab } from "../panel/LeftPanel.tsx";
import { scratch } from "../state/agent.ts";
import { stageOf, viewOnly } from "../state/canvases.ts";
import { adoptFormerComments } from "../state/comments.ts";
import { preview, state } from "../state/deck.ts";
import { setPersonStage } from "../state/decks.ts";
import { ensureHistory } from "../state/history.ts";
import { call, setFailureSink, start } from "../state/line.ts";
import { notice } from "../state/notices.ts";
import { pens, rewatch, watchCanvas } from "../state/pens.ts";
import { mode, setMode } from "../state/selection.ts";
import { listen, readAll } from "../state/sync.ts";
import type { ChatItem, Page } from "../state/types/index.ts";
import { releasePages, setPanelOpen, setPicking } from "../state/ui.ts";
import { agentViews } from "../state/views.ts";
import { agentsHere, pagesInPlay, penOnScreen } from "./model.ts";
import { installTooltips } from "./tooltip.ts";

// The page's wiring, made once by the shell's view: the alerts, the line and
// its sync, the drawing on screen, the floats and the dock, files, keys and
// the canvas host's inputs. It holds no data: stores are in state/.

/** Open the line, read everything when it comes up, and hear the events after. */
function mountLine(raise: ReturnType<typeof createAlerts>["raise"], landed: () => void, hearCreated: (request: string, path: string) => void): void {
	const hooks = { raise, landed, hearCreated };
	onMount(() => {
		setFailureSink((text) => notice("warn", text));
		const stop = listen(hooks);
		void start((up) => {
			if (!up) return;
			scratch.forgetAsked();
			forgetAskedResults();
			rewatch();
			void readAll(hooks);
		});
		setTimeout(releasePages, 2500);
		setToolResultSender((itemId) => {
			const agentId = Object.keys(state.agents).find((id) => state.agents[id]?.transcript.some((item) => item.id === itemId));
			if (!agentId) return false;
			void call<ChatItem>("chat.get", { agent: agentId, item: itemId }).then((answer) => answer.ok && receiveToolResult(itemId, (answer.value as { result?: string }).result ?? ""));
			return true;
		});
		createEffect(() => watchCanvas(stageOf(state.focused)?.name));
		onCleanup(stop);
	});
}

/** What the browser keeps per conversation: its views on this device, and comments made before canvases. */
function keepViews() {
	const views = createMemo(() => agentViews(state.deck?.path ?? ""));
	createEffect(() => {
		const agent = state.focused;
		const canvas = stageOf(agent)?.name;
		if (agent && canvas) untrack(() => adoptFormerComments(agent, canvas));
	});
	createEffect(() => {
		const ids = state.chats.map((chat) => chat.id);
		if (ids.length > 0) views().retain(ids);
	});
	return views;
}

/** A shared canvas you may only view, and a page that cannot write, browse and do not ink. */
function browseWhenReadOnly() {
	const viewOnlyStage = () => viewOnly(stageOf(state.focused)?.name);
	createEffect(() => {
		if (can("write") && !viewOnlyStage()) return;
		if (mode() !== "browse") setMode("browse");
		if (drawing()) setDrawing(false);
	});
	onMount(() => {
		const press = (event: PointerEvent) => {
			const pen = event.pointerType === "pen";
			if (pen === document.documentElement.hasAttribute("data-pen")) return;
			document.documentElement.toggleAttribute("data-pen", pen);
			if (pen) getSelection()?.removeAllRanges();
		};
		window.addEventListener("pointerdown", press, true);
		onCleanup(() => window.removeEventListener("pointerdown", press, true));
	});
	return viewOnlyStage;
}

/** The conversation on screen: its row, its transcript, whether it is busy. */
function focusedConversation(chatShown: () => boolean) {
	const focusedChat = createMemo(() => state.chats.find((chat) => chat.id === state.focused));
	const transcript = createMemo(() => (state.focused ? (state.agents[state.focused]?.transcript ?? []) : []));
	createEffect(() => {
		if (chatShown()) ensureHistory(state.focused);
	});
	const busy = createMemo(() => (focusedChat()?.state ?? "idle") !== "idle");
	return { focusedChat, transcript, busy };
}

/** The drawing and the cards on the conversation's canvas. */
function canvasOnScreen() {
	const stagePen = createMemo(() => {
		const name = stageOf(state.focused)?.name;
		return penOnScreen(name ? pens()[name] : undefined, (id) => state.identities[id]);
	});
	const [shownPages, setShownPages] = createStore<Page[]>([]);
	createComputed(() => {
		const list = pagesInPlay(state.pages, state.focused ? (state.agents[state.focused]?.inPlay ?? []) : []);
		setShownPages(reconcile(list, { key: "path", merge: true }));
	});
	return { stagePen, stagePages: (): Page[] => shownPages };
}

/** Which tab of the panel to open, asked by a button elsewhere. */
function panelAsks() {
	const [panelAsk, setPanelAsk] = createSignal<{ tab: PanelTab; at: number } | undefined>();
	const ask = (tab: PanelTab) => {
		setPanelOpen(true);
		setPanelAsk({ tab, at: Date.now() });
	};
	return { panelAsk, openAgentsPanel: () => ask("agents"), openAppsPanel: () => ask("apps") };
}

/** Ask the person for a file from the deck. */
const pickFile = () =>
	new Promise<string | undefined>((resolve) => {
		setPicking({
			purpose: "attach",
			resolve: (picked: string | undefined) => {
				setPicking(undefined);
				resolve(picked);
			},
		});
	});

/** The whole page's wiring. Call once, inside the shell's view. */
export function createPage() {
	const [atTurn, setAtTurn] = createSignal<{ id: string; at: number } | undefined>(undefined);
	const { prefs, setPrefs, raise } = createAlerts({ focusAgent });
	const views = keepViews();
	const viewOnlyStage = browseWhenReadOnly();
	const layout = createChatLayout();
	const conversation = focusedConversation(layout.chatShown);
	const onScreen = canvasOnScreen();
	const [deckSeen, setDeckSeen] = createSignal(0);
	const files = createFileDrops();
	mountLine(raise, () => setDeckSeen((n) => n + 1), (request, path) => files.hearCreated(request, path));
	const [editorHandle, setEditorHandle] = createSignal<FramedHandle>();
	const [penSelected, setPenSelected] = createSignal<string[]>([]);
	const { frameWhenPlaced, playAndFrame } = createFraming(onScreen.stagePages);
	const pills = createPills({ stagePen: onScreen.stagePen, editorHandle, setPenSelected, playAndFrame });
	const bar = createBar({ titleOf: (path) => pills.titleOf(path), itemName: (id) => pills.itemName(id) });
	setCommentSender((ids) => bar.sendFromBar("", ids));
	const floats = createFloats();
	const dock = createDock({ phone: layout.phone, phoneChat: layout.phoneChat, setPhoneChat: (open, from) => layout.setPhoneChat(open, from), viewWidth: layout.viewWidth }, floats);
	const [underSheet, setUnderSheet] = createSignal(false);
	const panels = panelAsks();
	const landing = createCameraLanding({ views, stagePen: onScreen.stagePen, stagePages: onScreen.stagePages, deckSeen });
	const apps = createAppsPanel(onScreen.stagePages, frameWhenPlaced);
	const [findAt, setFindAt] = createSignal(0);
	wireBrowser({ files, editorHandle, park: landing.park, find: setFindAt });
	const hereAgents = createMemo(() => agentsHere(state.chats, (id) => stageOf(id)?.name, state.focused));
	return { atTurn, setAtTurn, prefs, setPrefs, views, viewOnlyStage, layout, ...conversation, ...onScreen, files, editorHandle, setEditorHandle, penSelected, setPenSelected, frameWhenPlaced, playAndFrame, pills, bar, dock, underSheet, setUnderSheet, ...panels, landing, apps, findAt, hereAgents, presenting: createPresenting(), pickFile };
}

/** The browser's own hooks: files dropped and pasted, keys, the viewport, tooltips, rings, the theme. */
function wireBrowser(inputs: { files: ReturnType<typeof createFileDrops>; editorHandle: () => FramedHandle | undefined; park: () => void; find: (at: number) => void }): void {
	inputs.files.install({
		preview,
		forward: (data) => {
			const handle = inputs.editorHandle();
			if (!handle?.paste) return false;
			handle.paste(data);
			return true;
		},
	});
	installViewport();
	installKeys({ openPanel: () => setPanelOpen(true), find: inputs.find });
	setPersonStage(() => stageOf(state.focused)?.name, () => state.focused);
	reportCameraOnArrival();
	onMount(() => {
		watchInsets();
		closeHistory();
		onCleanup(installTooltips());
		onCleanup(syncRings());
		const away = () => inputs.park();
		addEventListener("pagehide", away);
		onCleanup(() => removeEventListener("pagehide", away));
	});
	createEffect(() => {
		const dark = scheme() === "dark";
		untrack(inputs.editorHandle)?.setDark(dark);
	});
}

export type PageWiring = ReturnType<typeof createPage>;
