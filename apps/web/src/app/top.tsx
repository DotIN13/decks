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
import { TabStrip } from "../tabs/TabStrip.tsx";
import { canvasOnScreen, homeCanvas, homeInFront, showTab } from "../tabs/tabs.ts";

/**
 * The top of the page: the bar on the left (the panel's button, the agents, the canvas), the corner on
 * the right (who is here, the usage ring, the overflow), and the canvas manager they open.
 */
export function Top(props: { parts: Parts }) {
	const { layout, present, stagePages } = props.parts;
	const phone = layout.phone;
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
				/* The chip is the home tab: the conversation's canvas, whichever tab is in front. */
				{...(homeCanvas() ? { stage: homeCanvas()!.title } : {})}
				home={{ front: homeInFront(), show: () => showTab("home") }}
				/* A chip is about 150 px: the row folds into one chip when the bar, beside the side panel, has room for fewer than there are; always on a phone. */
				tabs={<TabStrip phone={phone()} room={phone() ? 0 : Math.max(0, Math.floor((layout.viewWidth() - (panelOpen() ? 360 : 0) - 600) / 150))} />}
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
							more={moreItems(stagePages)}
						/>
					</span>
				}
			>
				<TopRight
					here={hereAgents()}
					identities={state.identities}
					unread={unread}
					focused={state.focused}
					onFocus={focusAgent}
					onPresent={present}
					usage={state.focused ? state.agents[state.focused]?.usage : undefined}
					onContext={() => openUsage(state.focused)}
					more={moreItems(stagePages)}
				/>
<Show when={showFps()}>
<FpsMeter />
</Show>
			</Show>
		</>
	);
}
