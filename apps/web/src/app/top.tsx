import { createMemo, Show } from "solid-js";
import { CanvasManager } from "../canvases/CanvasManager.tsx";
import { scheme } from "../lib/theme.ts";
import { FpsMeter, showFps } from "../perf/fps.tsx";
import { TopBar } from "../shell/TopBar.tsx";
import { TopRight } from "../shell/TopRight.tsx";
import { stageOf, stages } from "../state/canvases.ts";
import { state } from "../state/deck.ts";
import { call, warnIfFailed } from "../state/socket.ts";
import { openUsage, panelOpen, unread } from "../state/ui.ts";
import { canvasMenu, type CanvasMenuTrigger } from "./canvas-menu.tsx";
import { moreItems } from "./more-menu.ts";
import type { Parts } from "./parts.ts";
import { closeAgent, copyShared, createCanvas, focusAgent, newAgent, openAgentsPanel, openCanvas, setStagesOpen, showPanel, stagesOpen, viewOnlyStage } from "./person.ts";
import { openPlus, openTabsList, TabStrip } from "../tabs/TabStrip.tsx";
import Plus from "lucide-solid/icons/plus";
import { Dynamic } from "solid-js/web";
import { touchTop } from "../tabs/budget.ts";
import { kindOf } from "../tabs/kinds.ts";
import { canvasOnScreen, front, onCanvas, showCanvas } from "../tabs/tabs.ts";

/**
 * The top of the page: the bar on the left (the panel's button, the agents, the canvas), the corner on
 * the right (who is here, the usage ring, the overflow), and the canvas manager they open.
 */
export function Top(props: { parts: Parts }) {
	const { layout, present, stagePages } = props.parts;
	const phone = layout.phone;
	/** A phone's or a tablet's bar (`tabs/budget.ts`): the chip names the tab in front, the tabs are one count, and the + is in ⋯. */
	const touch = () => touchTop(phone());
	/** What the bar's chip says: the canvas the chat's camera is on; on a touch bar, the tab in front, whatever its kind. */
	const shownTitle = () => (touch() && !onCanvas() ? (kindOf(front().kind)?.title(front()) ?? front().target) : canvasOnScreen()?.title);
	/** The ⋯ menu: on a touch bar it also opens a tab, which the bar has no + for. */
	const more = () => [...(touch() ? [{ label: "Open a tab", icon: Plus, onPick: openPlus }] : []), ...moreItems(stagePages)];
	/** The agents whose canvas is the one on screen: the faces in the top-right bar. */
	const hereAgents = createMemo(() => {
		const stage = canvasOnScreen()?.name;
		if (!stage) return state.chats.filter((chat) => chat.id === state.focused);
		return state.chats.filter((chat) => stageOf(chat.id)?.name === stage);
	});
	return (
		<>
			{/*
				The two top clusters, and the tools are inside the left one.

				`Palette` is gone as a free-standing float: it was already top-centre, and
				what it lacked was a row to be part of. With the bar deleted it sits at the
				same height as the agent and the camera, top centre goes empty — which is
				where notices land, and they had been dodging it — and there is one
				`data-inset="top"` where there were two.
			*/}
			<TopBar
				/* On a desktop the deck is in the panel's head; folded, the top bar holds only the button that brings the panel back. */
				panelOpen={panelOpen() && !phone()}
				desktop={!phone()}
				onTogglePanel={() => showPanel(!panelOpen())}
				chats={state.chats}
				identities={state.identities}
				focused={state.focused}
				unread={unread}
				onFocus={focusAgent}
				onNew={(kind) => void newAgent({ ...(kind ? { kind } : {}) })}
				onClose={closeAgent}
				onMoreAgents={openAgentsPanel}
				phone={phone()}
				/* The chip is the canvas the camera of the chat on screen is on, in front or held behind a card, a document or an app. */
				{...(shownTitle() ? { stage: shownTitle()! } : {})}
				{...(touch() && !onCanvas() && kindOf(front().kind) ? { mark: () => <Dynamic component={kindOf(front().kind)!.icon} size={16} /> } : {})}
				/* A desktop's chip brings the canvas forward from behind another tab; a touch bar's names that tab, and opens the tabs. */
				canvas={{ front: onCanvas(), show: touch() ? openTabsList : showCanvas }}
				/* A chip is about 150 px: the row folds into one chip when the bar, beside the side panel, has room for fewer than there are; always on a phone. */
				tabs={<TabStrip touch={touch()} room={Math.max(0, Math.floor((layout.viewWidth() - (panelOpen() ? 360 : 0) - 600) / 150))} />}
				{...(stages().length > 0 ? { onStages: () => void setStagesOpen((was) => !was), stagesOpen: stagesOpen() } : {})}
				{...(!phone() && stages().length > 0 ? { canvasMenu: (trigger: CanvasMenuTrigger) => canvasMenu(trigger) } : {})}
				{...(viewOnlyStage() ? { viewOnly: viewOnlyStage()!.shared!.owner, onCopy: () => copyShared(viewOnlyStage()!.name) } : {})}
			/>

			{/*
				The stage manager: every stage in the deck, over the canvas.

				Here rather than inside the pill, because it covers the canvas and the pill is a
				cluster of controls 40px tall. The pill owns the button; this owns the surface.
			*/}
			<CanvasManager
				stages={stages()}
				onRename={(name, to) => void call("canvas.rename", [to, { canvas: name }]).then(warnIfFailed)}
				onDelete={(name) => void call("canvas.remove", [name]).then(warnIfFailed)}
				onCopy={copyShared}
				here={canvasOnScreen()?.name}
				open={stagesOpen()}
				onClose={() => void setStagesOpen(false)}
				onPick={openCanvas}
				onNew={createCanvas}
				scheme={scheme()}
				drawer={phone()}
			/>

			<Show
				when={!phone()}
				fallback={
					<span class="v3-phone-more">
						<TopRight
							menuOnly
							here={[]}
							identities={state.identities}
							unread={unread}
							focused={state.focused}
							onFocus={focusAgent}
							onPresent={present}
							usage={state.focused ? state.agents[state.focused]?.usage : undefined}
							onContext={() => openUsage(state.focused)}
							more={more()}
						/>
					</span>
				}
			>
				<TopRight
					/* On a touch bar the agent you talk to is the face at the left already: alone on the canvas, it is not said twice. */
					here={touch() && hereAgents().length === 1 && hereAgents()[0]!.id === state.focused ? [] : hereAgents()}
					identities={state.identities}
					unread={unread}
					focused={state.focused}
					onFocus={focusAgent}
					onPresent={present}
					usage={state.focused ? state.agents[state.focused]?.usage : undefined}
					onContext={() => openUsage(state.focused)}
					more={more()}
				/>
<Show when={showFps()}>
<FpsMeter />
</Show>
			</Show>
		</>
	);
}
