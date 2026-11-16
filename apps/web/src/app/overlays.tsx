import { Show } from "solid-js";
import { CanvasOps } from "../canvases/CanvasOps.tsx";
import { Settings } from "../settings/Settings.tsx";
import { UsageModal } from "../settings/UsageModal.tsx";
import { ConfirmDialog } from "../shell/ConfirmDialog.tsx";
import { setState, state } from "../state/deck.ts";
import { call, warnIfFailed } from "../state/socket.ts";
import { ops, picking, readUsage, setOps, setSettings, setUsagePanel, settings, usagePanel, usageReport } from "../state/ui.ts";
import { FilePicker } from "./files/FilePicker.tsx";
import type { Parts } from "./parts.ts";

/** What opens over the canvas and under the panel: the canvas's own menu of operations, a question to confirm, and the file picker. */
export function Pickers(props: { parts: Parts }) {
	const { files } = props.parts;
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
						onAdd={(file) => files.addFile(file)}
						purpose={request().purpose ?? "embed"}
						{...(request().google ? { onGoogle: (url: string) => request().resolve(`google:${url}`) } : {})}
					/>
				)}
			</Show>
		</>
	);
}

/** What opens over everything: the usage panel and Settings. */
export function Modals(props: { parts: Parts }) {
	const { layout, prefs, setPrefs } = props.parts;
	const phone = layout.phone;
	return (
		<>
			{/*
				The usage panel — the plan, the spend, and what has been driving it.
				
				Drawn only while it is open *for the agent you are looking at*: the figures are
				one agent's, so a switch closes it instead of leaving this agent's name over the
				last one's plan.
				
				Its own `Show`, not nested in the settings one — which is where the modal it
				replaced first landed, so it could only open while Settings happened to be open
				too.
			*/}
			<Show when={usagePanel() && usagePanel() === state.focused}>
				<UsageModal
					usage={state.focused ? state.agents[state.focused]?.usage : undefined}
					report={usageReport().report}
					error={usageReport().error}
					loading={usageReport().loading}
					at={usageReport().at}
					onRefresh={() => readUsage(state.focused)}
					onClose={() => setUsagePanel(undefined)}
				/>
			</Show>

			<Show when={settings()}>
				<Settings
					prefs={prefs()}
					onPrefs={setPrefs}
					accounts={state.accounts}
					active={state.activeAccount}
					onAdd={() => void call("account.add").then(warnIfFailed)}
					onForget={(id) => void call("account.forget", [id]).then(warnIfFailed)}
					web={state.web}
					onWebRepair={() => void call<{ code?: string }>("web.repair").then((answer) => answer.ok && setState("web", (web) => (web ? { ...web, code: answer.value?.code } : web)))}
					onWebStop={() => void call("web.stop")}
					phone={phone()}
					onClose={() => setSettings(false)}
				/>
			</Show>
		</>
	);
}
