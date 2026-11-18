import { Show } from "solid-js";
import { LeftPanel } from "../panel/LeftPanel.tsx";
import { ChatSection } from "../shell/ChatSection.tsx";
import { camera } from "../state/camera.ts";
import { stages } from "../state/canvases.ts";
import { state } from "../state/deck.ts";
import { editDrawing } from "../state/decks.ts";
import { selected } from "../state/selection.ts";
import { call, warnIfFailed } from "../state/socket.ts";
import { pagesStarted, panelOpen, setSettings, unread } from "../state/ui.ts";
import { canvasMenu, type CanvasMenuTrigger } from "./canvas-menu.tsx";
import { FocusedStream } from "./chat-stream.tsx";
import type { Parts } from "./parts.ts";
import { closeAgent, focusAgent, newAgent, panelAsk, setStagesOpen, showPanel } from "./person.ts";
import { canvasOnScreen } from "../tabs/tabs.ts";

/**
 * The side panel, with the conversation in its lower half; taken out of the panel it is a float over
 * the canvas (`chat-float.ts`), and on a phone it is a sheet of its own instead.
 */
export function SidePanel(props: { parts: Parts }) {
	const { layout, chatFloat, apps, pills, stagePen, stagePages, penSelected, setPenSelected, editorHandle, findAt, focusedChat, transcript, atTurn } = props.parts;
	const { phone, chatFolded, setChatFolded, chatOut, phoneChat, setPhoneChat, sheetFrom, sheetLeaving, chatShown, holdHistory } = layout;
	return (
		<>
			{/*
			 * Two panels where there was one, in the same corner and one at a time.
			 *
			 * The agent list and the boards an agent is holding were stacked inside a single
			 * surface, so opening either brought both — you scrolled past six chats to see a
			 * thumbnail, or past four thumbnails to switch agent. They answer different
			 * questions and now they are asked separately.
			 */}
			{/*
				One panel where there were two asides and a modal — and one list in it.

				The agent list moved into the pill's dropdown — a list you switch *with* is a
				selector, and a selector belongs on the thing it selects — and the board browser
				stopped being a full-screen sheet over the canvas you were trying to look at.
				It was this panel's second tab for a while; it is the third section of its one
				list now, because Context and Deck were never two collections (`panel-groups.ts`).

				Mounted while folded, deliberately: it registers `⌘\`, and a `<Show>` here
				would take the shortcut away in exactly the state it exists for.
			*/}
			<LeftPanel
				{...(panelAsk() ? { ask: panelAsk()! } : {})}
				boards={state.pages}
				{...(stagePen()?.doc ? { canvasDoc: stagePen()!.doc } : {})}
				{...(canvasOnScreen() ? { canvasTitle: canvasOnScreen()!.title } : {})}
				selectedItems={penSelected()}
				onPickItem={pills.pickItem}
				onCanvases={() => void setStagesOpen((was) => !was)}
				{...(stages().length > 0 ? { canvasMenu: (trigger: CanvasMenuTrigger) => canvasMenu(trigger) } : {})}
				onPickArrows={(ids) => {
					editorHandle()?.select(ids);
					setPenSelected(ids);
				}}
				desktop={!phone()}
				onSettings={() => {
					setSettings(true);
					void call("account.list", [{ limits: true }]);
				}}
				pens={state.deck?.pens ?? []}
				onPlacePen={(pen) => {
					// A pen file goes on the stage as a ref, its corner at the middle of the view, as an agent places one.
					const agentId = state.focused;
					const at = camera();
					if (agentId) void editDrawing(agentId, [{ op: "insert", node: { type: "ref", ref: pen.ref }, box: { x1: Math.round(at.x), y1: Math.round(at.y) } }]);
				}}
				listMayGrow={pagesStarted()}
				current={selected()}
				/* `stagePages` is the same answer the stage draws from, so the panel's "on the
				   stage" section and the boards on screen cannot disagree. */
				inPlay={stagePages().map((board) => board.path)}
				/* What the focused agent holds and has taken off its stage. */
				kept={state.focused ? (state.contexts[state.focused] ?? []) : []}
				focused={state.focused}
				open={panelOpen()}
				onOpenChange={showPanel}
				findAt={findAt()}
				/*
				 * The Agents tab. The same three signals the corner and the dropdown already
				 * take, so the panel is not a second source of truth about who exists — and
				 * `focusAgent` rather than a bare `agent.focus`, because switching moves the
				 * stage, the camera, the transcript and the draft together.
				 */
				chats={state.chats}
				identities={state.identities}
				unread={unread}
				onFocusAgent={focusAgent}
				onNewAgent={(workspace, kind) => void newAgent({ ...(kind ? { kind } : {}), ...(workspace ? { workspace } : {}) })}
				onCloseAgent={closeAgent}
				/* Your tags, which the agent cannot see or overwrite — a separate field from
				   `stage.me.setTags`, for the reason `protocol/Identity` gives. */
				onAgentTags={(id, tags) => void call("agent.set", [id, { tags }]).then(warnIfFailed)}
				/* The workspace, which is one field with two writers rather than two fields: the
				   agent declares one and you can move it, and whoever wrote last is where it is. */
				onAgentWorkspace={(id, workspace) => void call("agent.set", [id, { workspace }]).then(warnIfFailed)}
				onAgentRename={(id, name) => void call("agent.set", [id, { name }]).then(warnIfFailed)}
				onAbortAgent={(id) => void call("chat.abort", [id])}
				apps={apps.apps()}
				onAppsOpen={apps.loadApps}
				onApp={apps.onApp}
				onAppLogs={apps.onAppLogs}
				chat={
					<Show
						when={!phone() && !chatOut()}
						/* Held over the panel, the conversation's slot: a section of the panel's own layout, so it is exactly the room the conversation takes. */
						fallback={
							<Show when={!phone() && chatFloat.landing()}>
								<section class="v3-chat v3-chat-slot" aria-hidden="true" />
							</Show>
						}
					>
						<ChatSection
							chat={focusedChat()}
							identity={state.identities[state.focused ?? ""]}
							unread={state.focused ? (unread[state.focused] ?? 0) : 0}
							folded={chatFolded()}
							onFold={(folded) => {
								setChatFolded(folded);
								holdHistory();
							}}
							out={{ gripDown: chatFloat.gripDown }}
						>
							<FocusedStream shown={chatShown()} items={transcript()} chat={focusedChat()} atTurn={atTurn()} />
						</ChatSection>
					</Show>
				}
			/>
			<Show when={!phone() && chatOut()}>
				<ChatSection
					chat={focusedChat()}
					identity={state.identities[state.focused ?? ""]}
					unread={state.focused ? (unread[state.focused] ?? 0) : 0}
					folded={chatFolded()}
					onFold={(folded) => {
						setChatFolded(folded);
						holdHistory();
					}}
					float={{ placed: chatFloat.placed, cornerDown: chatFloat.cornerDown }}
				>
					<FocusedStream shown={chatShown()} items={transcript()} chat={focusedChat()} atTurn={atTurn()} />
				</ChatSection>
			</Show>
			<Show when={phone() && phoneChat()}>
				<ChatSection
					chat={focusedChat()}
					identity={state.identities[state.focused ?? ""]}
					unread={state.focused ? (unread[state.focused] ?? 0) : 0}
					folded={false}
					onFold={(folded, gone) => (folded ? setPhoneChat(false, undefined, gone) : undefined)}
					from={sheetFrom()}
					leaving={sheetLeaving()}
					sheet
				>
					<FocusedStream shown={chatShown()} items={transcript()} chat={focusedChat()} atTurn={atTurn()} />
				</ChatSection>
			</Show>
		</>
	);
}
