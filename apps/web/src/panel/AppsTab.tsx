import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { m } from "@decks/i18n";
import { AppLogs, AppRow, type AppAction, type PanelApp } from "./AppRow.tsx";

/**
 * The side panel's Apps tab: the deck's apps (`apps/`), each a row that shows, starts, stops or
 * deletes it, and the Logs panel of the one asked about.
 *
 * Mounted once by the panel and drawn only while `shown`, so the app picked and the logs open
 * last across a visit to another tab.
 */
export function AppsTab(props: {
	shown: boolean;
	/** Whether the panel is open: the apps are asked for when the tab is showing in an open panel. */
	open: boolean;
	query: string;
	/** The deck's apps; asked for when the tab opens. */
	apps?: PanelApp[];
	onAppsOpen?: () => void;
	/** Show, start, stop, restart or delete an app (`panel/AppRow.tsx`); its promise ends the row's wait. */
	onApp?: (app: PanelApp, action: AppAction) => Promise<unknown> | void;
	/** An app's recent output, for its Logs panel. */
	onAppLogs?: (app: PanelApp) => Promise<string[] | undefined>;
}) {
	/** The app picked in the tab, and the one whose logs are open. */
	const [pickedApp, setPickedApp] = createSignal<string>();
	const [logsOf, setLogsOf] = createSignal<PanelApp>();
	createEffect(() => {
		if (props.shown && props.open) props.onAppsOpen?.();
	});
	const apps = createMemo(() => {
		const q = props.query.trim().toLowerCase();
		return (props.apps ?? []).filter((app) => !q || app.title.toLowerCase().includes(q) || app.name.toLowerCase().includes(q));
	});

	return (
		<Show when={props.shown}>
			{/* The "Apps tab redesigned" mockup: rows 12px in like the search, no heading (the head counts them). */}
			<div class="panel-section v3-apps" data-kind="apps">
				<For each={apps()}>
					{(app) => <AppRow app={app} picked={pickedApp() === app.name} onPick={() => setPickedApp(app.name)} onAct={(action) => props.onApp?.(app, action)} onLogs={() => setLogsOf(app)} />}
				</For>
				<Show when={apps().length === 0}>
					<p class="m-0 px-2 py-2 text-ui leading-normal text-faint">
						{props.apps === undefined ? m.panel_apps_looking() : props.query.trim() ? m.panel_app_no_match({ query: props.query.trim() }) : m.panel_apps_none()}
					</p>
				</Show>
				<Show when={logsOf()}>{(app) => <AppLogs title={app().title} read={() => props.onAppLogs?.(app()) ?? Promise.resolve(undefined)} onClose={() => setLogsOf(undefined)} />}</Show>
			</div>
		</Show>
	);
}
