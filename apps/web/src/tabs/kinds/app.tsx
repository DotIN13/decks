import AppWindow from "lucide-solid/icons/app-window";
import { AppFrame, type AppFramePass } from "@decks/canvas/page";
import { Icon } from "@decks/ui";
import { createResource, createSignal, For, Match, Show, Switch } from "solid-js";
import { appFramePass, cardAgentCall } from "../../canvases/pass.ts";
import { scheme } from "../../lib/theme.ts";
import { act } from "../../state/decks.ts";
import type { TabKind } from "../kind.ts";
import { APPS_BEHIND } from "../budget.ts";
import { alive, reloadsOf, tabIdOf } from "../tabs.ts";

/**
 * An app, as a kind of tab: the app whole, in a frame of its own (`@decks/canvas`, `AppFrame`: the
 * frame every kind runs in, with the app kind inside), at an address with its app pass in the path. It
 * keeps running while it is not in front, within the device's budget (`budget.ts`): an app is a
 * program, and one put away starts again from nothing. An app that cannot load in a frame (one told its base path)
 * says so, with a button that opens it in the browser's tab.
 */
export const appKind: TabKind = {
	name: "app",
	address: "app",
	// By the app's own title once the deck's apps have been read, by its folder's name until then.
	title: (tab) => (tab.target ? (titleOf(tab.target) ?? tab.target) : undefined),
	offers: {
		label: "Apps",
		always: true,
		list: async () => (await readApps()).map((app) => ({ target: app.name, title: app.title || app.name, note: app.status })),
	},
	icon: (props) => <Icon of={AppWindow} size={props.size ?? 16} />,
	view: (tab, parts) => (
		<For each={alive("app", APPS_BEHIND).flatMap((one) => (one.target ? [one.target] : []))}>
			{(name) => <AppTab app={name} shown={tab()?.target === name} foot={parts.dock.dockCover()} />}
		</For>
	),
};

/** The deck's apps as last read, by name: for a tab's title, which is the app's own rather than its folder's. */
const [titles, setTitles] = createSignal<ReadonlyMap<string, string>>(new Map());
let asked = false;
async function readApps(): Promise<Array<{ name: string; title?: string; status: string }>> {
	const list = (await act<Array<{ name: string; title?: string; status: string }>>("apps.list", [])) ?? [];
	setTitles(new Map(list.flatMap((app) => (app.title ? [[app.name, app.title] as const] : []))));
	return list;
}
/** An app's title; the first ask reads the deck's apps, and the title follows when they have come. */
function titleOf(name: string): string | undefined {
	if (!asked) {
		asked = true;
		void readApps().catch(() => (asked = false));
	}
	return titles().get(name);
}

/** How many times each app has been told to load its page again (`apps.reload`), as the harness counts them. */
const [appReloads, setAppReloads] = createSignal<ReadonlyMap<string, number>>(new Map());
/** The harness said an app's pages are to load again (`app.changed` with `reload`): its tab is made again, once for each count. */
export const heardAppReload = (name: string, reload: number) => setAppReloads((was) => (was.get(name) === reload ? was : new Map(was).set(name, reload)));

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
					{(held) => (
						// Made again at each reload: a new frame is how a sandboxed page loads again, with what it has saved since.
						<Show when={[appReloads().get(props.app), reloadsOf(tabIdOf("app", props.app))]} keyed>
							{(_load) => <AppFrame app={props.app} title={titleOf(props.app) ?? props.app} pass={() => Promise.resolve(held())} dark={scheme() === "dark"} foot={props.foot} agent={cardAgentCall} />}
						</Show>
					)}
				</Match>
			</Switch>
		</div>
	);
}
