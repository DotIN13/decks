import { m } from "@decks/i18n";
import { createMemo, Show } from "solid-js";
import { CanvasManager } from "../canvases/CanvasManager.tsx";
import { scheme } from "../lib/theme.ts";
import { FpsMeter, showFps } from "../perf/fps.tsx";
import { TopBar } from "../shell/TopBar.tsx";
import { TopRight } from "../shell/TopRight.tsx";
import { canvasOf, canvases } from "../state/canvases.ts";
import { state } from "../state/deck.ts";
import { call, warnIfFailed } from "../state/socket.ts";
import { openUsage, panelOpen, unread } from "../state/ui.ts";
import { canvasMenu, type CanvasMenuTrigger } from "./canvas-menu.tsx";
import { moreItems } from "./more-menu.ts";
import type { Parts } from "./parts.ts";
import { closeAgent, copyShared, createCanvas, focusAgent, newAgent, openAgentsPanel, openCanvas, setCanvasesOpen, showPanel, canvasesOpen, viewOnlyCanvas } from "./person.ts";
import { openPlus, openTabsList, TabStrip } from "../tabs/TabStrip.tsx";
import { TabActs } from "../tabs/TabActs.tsx";
import { showOnCanvas } from "../tabs/show-on-canvas.ts";
import Plus from "lucide-solid/icons/plus";
import { Dynamic } from "solid-js/web";
import { touchTop } from "../tabs/budget.ts";
import { kindOf } from "../tabs/kinds.ts";
import { canvasOnScreen, front, onCanvas } from "../tabs/tabs.ts";

/**
 * The top of the page: the bar on the left (the panel's button, the agents, the canvas), the corner on
 * the right (who is here, the usage ring, the overflow), and the canvas manager they open.
 *
 * Off a phone the two are one header across the canvas's column (`.v3-header`, the ground both sit
 * on, `styles/v3.css`): as tall as the band the two used to float in, so nothing under it moves. With
 * a card, a document or an app in front the right end also holds what that tab offers (`TabActs`).
 */
export function Top(props: { parts: Parts }) {
	const { layout, present, canvasHost } = props.parts;
	const phone = layout.phone;
	/** A phone's or a tablet's bar (`tabs/budget.ts`): the chip names the tab in front, the tabs are one count, and the + is in ⋯. */
	const touch = () => touchTop(phone());
	/** What a touch bar's chip says: the tab in front, whatever its kind. (A desktop's bar has a row of tabs and no chip of its own.) */
	const shownTitle = () => (touch() && !onCanvas() ? (kindOf(front().kind)?.title(front()) ?? front().target) : canvasOnScreen()?.title);
	/** The ⋯ menu: on a touch bar it also opens a tab, which the bar has no + for. */
	const more = () => [...(touch() ? [{ label: m.app_open_tab(), icon: Plus, onPick: openPlus }] : []), ...moreItems()];
	/** The agents whose canvas is the one on screen: the faces in the top-right bar. */
	const hereAgents = createMemo(() => {
		const canvas = canvasOnScreen()?.name;
		if (!canvas) return state.chats.filter((chat) => chat.id === state.focused);
		return state.chats.filter((chat) => canvasOf(chat.id)?.name === canvas);
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
			<Show when={!phone()}>
				<div class="v3-header" aria-hidden="true" />
			</Show>
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
				/* A desktop's bar is a row of tabs, the canvas among them. A touch bar has one chip, which names the tab in front and, while that is no canvas, opens the tabs. */
				row={!touch()}
				{...(shownTitle() ? { canvasChip: shownTitle()! } : {})}
				{...(touch() && !onCanvas() && kindOf(front().kind) ? { mark: () => <Dynamic component={kindOf(front().kind)!.icon} size={16} /> } : {})}
				canvas={{ front: onCanvas(), show: openTabsList }}
				/* A tab is about 150 px: with more tabs than the bar, beside the side panel, has room for, the row shows the first of them and a count lists them all; a touch bar always shows the count. */
				tabs={<TabStrip touch={touch()} room={Math.max(0, Math.floor((layout.viewWidth() - (panelOpen() ? 360 : 0) - 600) / 150))} />}
				{...(canvases().length > 0 ? { onCanvases: () => void setCanvasesOpen((was) => !was), canvasesOpen: canvasesOpen() } : {})}
				{...(!phone() && canvases().length > 0 ? { canvasMenu: (trigger: CanvasMenuTrigger) => canvasMenu(trigger) } : {})}
				{...(viewOnlyCanvas() ? { viewOnly: viewOnlyCanvas()!.shared!.owner, onCopy: () => copyShared(viewOnlyCanvas()!.name) } : {})}
			/>

			{/*
				The stage manager: every stage in the deck, over the canvas.

				Here rather than inside the pill, because it covers the canvas and the pill is a
				cluster of controls 40px tall. The pill owns the button; this owns the surface.
			*/}
			<CanvasManager
				canvases={canvases()}
				onRename={(name, to) => void call("canvas.rename", [to, { canvas: name }]).then(warnIfFailed)}
				onDelete={(name) => void call("canvas.remove", [name]).then(warnIfFailed)}
				onCopy={copyShared}
				here={canvasOnScreen()?.name}
				open={canvasesOpen()}
				onClose={() => void setCanvasesOpen(false)}
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
					acts={<TabActs onShow={(tab) => void showOnCanvas(tab, { frameWhenPlaced: canvasHost.frameWhenPlaced })} />}
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
