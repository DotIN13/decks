import AppWindow from "lucide-solid/icons/app-window";
import { AppFrame, type AppFramePass } from "@decks/canvas";
import { Icon } from "@decks/ui";
import { createResource, For, Match, Switch } from "solid-js";
import { appFramePass, cardAgentCall } from "../../canvases/pass.ts";
import { scheme } from "../../lib/theme.ts";
import type { TabKind } from "../kind.ts";
import { tabs } from "../tabs.ts";

/**
 * An app, as a kind of tab: the app whole, in a frame of its own (`@decks/canvas`, `AppFrame`: the
 * frame every kind runs in, with the app kind inside), at an address with its app pass in the path. It
 * keeps running while it is not in front: an app is a program, and one put away would start again
 * from nothing each time it came forward. An app that cannot load in a frame (one told its base path)
 * says so, with a button that opens it in the browser's tab.
 */
export const appKind: TabKind = {
	name: "app",
	address: "app",
	title: (tab) => tab.target,
	says: (tab) => (tab.target ? `the app ${tab.target}` : undefined),
	icon: (props) => <Icon of={AppWindow} size={props.size ?? 16} />,
	view: (tab, parts) => (
		<For each={tabs().flatMap((one) => (one.kind === "app" && one.target ? [one.target] : []))}>
			{(name) => <AppTab app={name} shown={tab()?.target === name} foot={parts.dock.dockCover()} />}
		</For>
	),
};

function AppTab(props: { app: string; shown: boolean; foot: number }) {
	// Asked for here, once, so a refusal is said in the tab; the frame is handed what came.
	const [pass] = createResource(
		() => props.app,
		(name) => appFramePass(name).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error)))),
	);
	return (
		<div class="surface" data-surface="app" style={{ display: props.shown ? undefined : "none" }}>
			<Switch>
				<Match when={pass() instanceof Error && (pass() as Error)}>
					{(error) => (
						<div class="tab-missing">
							<p>{error().message}</p>
							<button type="button" class="tab-missing-open" onClick={() => window.open(`/app/${encodeURIComponent(props.app)}/`, "_blank", "noopener")}>
								Open in the browser's tab
							</button>
						</div>
					)}
				</Match>
				<Match when={!(pass() instanceof Error) && (pass() as AppFramePass | undefined)}>
					{(held) => <AppFrame app={props.app} title={props.app} pass={() => Promise.resolve(held())} dark={scheme() === "dark"} foot={props.foot} agent={cardAgentCall} />}
				</Match>
			</Switch>
		</div>
	);
}
