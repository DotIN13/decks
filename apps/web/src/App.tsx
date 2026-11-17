import { can } from "./connections/backend.ts";
import { DockBar } from "./app/dock-bar.tsx";
import { Modals, Pickers } from "./app/overlays.tsx";
import { createParts } from "./app/parts.ts";
import { SidePanel } from "./app/side-panel.tsx";
import { Top } from "./app/top.tsx";
import { touchTop } from "./tabs/budget.ts";
import { rememberTabs } from "./tabs/remember.ts";
import { TabView } from "./tabs/TabView.tsx";
import { NoticeStrip } from "./shell/NoticeStrip.tsx";

/**
 * The shell: the tab in front (`tabs/TabView.tsx`: a canvas, with its tools), and the page's sections
 * floating over it.
 *
 * The parts are wired once (`app/parts.ts`): what is on screen, the layout, the dock, the files, the
 * camera's landing, and the connection to the harness. Each section draws from them and from the
 * app's state: the top bars (`app/top.tsx`), the side panel with the conversation
 * (`app/side-panel.tsx`), what opens over them (`app/overlays.tsx`) and the dock with the
 * composer (`app/dock-bar.tsx`). What the person does to agents and canvases from any of them is
 * `app/person.ts`.
 *
 * There is no title bar: a canvas app should not spend a strip of every window on a logo. The
 * connection state shows in the agent's own face, since a socket that is down is an agent that
 * cannot be doing anything. And there is no zoom bar and no turn bar: where you are looking is a
 * chip in the top-right cluster, and a bubble carries its own rewind button.
 */
export function App() {
	const parts = createParts();
	const { presenting, layout } = parts;
	rememberTabs();
	return (
		<div class="app" data-presenting={presenting() ? "true" : undefined} data-phone={layout.phone() ? "true" : undefined} data-touch-top={touchTop(layout.phone()) ? "true" : undefined} data-reader={can("write") ? undefined : ""}>
			<div class="work">
				<TabView parts={parts} />
				<Top parts={parts} />
				<Pickers parts={parts} />
				<SidePanel parts={parts} />
				<Modals parts={parts} />
				<DockBar parts={parts} />
				<NoticeStrip />
			</div>
		</div>
	);
}
