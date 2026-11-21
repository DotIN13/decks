import AppWindow from "lucide-solid/icons/app-window";
import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import Ellipsis from "lucide-solid/icons/ellipsis";
import Maximize2 from "lucide-solid/icons/maximize-2";
import Play from "lucide-solid/icons/play";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import Square from "lucide-solid/icons/square";
import Terminal from "lucide-solid/icons/terminal";
import Trash2 from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import { createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon, Popover } from "@decks/ui";
import { m } from "@decks/i18n";

export type PanelApp = { name: string; title: string; status: string; board: string };

/** What the ⋯ menu and a double-click ask of an app (`App.tsx` carries them out). */
export type AppAction = "show" | "run-show" | "start" | "stop" | "restart" | "reload" | "delete";

/** Bright tiles, one per app by its name; no olive. */
const TILES = ["#2563eb", "#0ea5e9", "#7c3aed", "#14b8a6", "#db2777", "#f97316", "#e11d48", "#9333ea"];
function tileColour(name: string): string {
	let h = 0;
	for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	return TILES[h % TILES.length] ?? TILES[0]!;
}

/** An app's state in a word, read when drawn. */
const WORD: Record<string, () => string> = {
	running: () => m.panel_app_running(),
	asleep: () => m.panel_app_asleep(),
	stopped: () => m.panel_app_stopped(),
	broken: () => m.panel_app_broken(),
	installing: () => m.panel_app_installing(),
	building: () => m.panel_app_building(),
	starting: () => m.panel_app_starting(),
	stopping: () => m.panel_app_stopping(),
};

/**
 * One app in the Apps tab, as the "Apps tab redesigned" mockup has it: a bright tile, its name, and
 * its state in a word with a dot (green running, amber and breathing while it starts or stops, red
 * broken) beside its folder. A click picks it; a double-click starts it if it is stopped and shows
 * it on the canvas; ⋯, or a right-click on the row, opens the rest to the right of the row.
 */
export function AppRow(props: {
	app: PanelApp;
	picked: boolean;
	onPick: () => void;
	onAct: (action: AppAction) => Promise<unknown> | void;
	onLogs: () => void;
}) {
	/** A start, stop or restart this row asked for and the server has not answered yet. */
	const [busy, setBusy] = createSignal<"starting" | "stopping">();
	const status = () => busy() ?? props.app.status;
	const running = () => status() === "running" || status() === "asleep";
	const moving = () => ["installing", "building", "starting", "stopping"].includes(status());
	const act = (action: AppAction) => {
		const wait = action === "stop" ? "stopping" : action === "start" || action === "restart" || (action === "run-show" && !running()) ? "starting" : undefined;
		if (wait) setBusy(wait);
		void Promise.resolve(props.onAct(action)).finally(() => setBusy(undefined));
	};
	let toggle: (() => void) | undefined;
	let close: (() => void) | undefined;
	const menu = (run: () => void) => {
		close?.();
		run();
	};
	return (
		<div
			class="v3-app-row"
			data-status={status()}
			data-on={props.picked || undefined}
			title={running() ? m.panel_app_dblclick_show({ title: props.app.title }) : m.panel_app_dblclick_run({ title: props.app.title })}
			onClick={() => props.onPick()}
			onDblClick={(event) => {
				if ((event.target as Element).closest(".v3-app-more")) return;
				act("run-show");
			}}
			onContextMenu={(event) => {
				event.preventDefault();
				props.onPick();
				toggle?.();
			}}
		>
			<span class="v3-app-tile" style={{ background: tileColour(props.app.name) }} aria-hidden="true">
				<Icon of={AppWindow} size={16} />
			</span>
			<span class="v3-app-text">
				<span class="v3-app-name truncate">{props.app.title}</span>
				<span class="v3-app-state" data-state={running() ? "on" : moving() ? "busy" : status() === "broken" ? "broken" : "off"}>
					<i aria-hidden="true" />
					<span class="v3-app-word">{WORD[status()]?.() ?? status()}</span>
					<span class="v3-app-path truncate">apps/{props.app.name}</span>
				</span>
			</span>
			<Popover
				placement="right-start"
				label={m.panel_app_menu({ title: props.app.title })}
				class="w-[210px]"
				trigger={(api) => {
					toggle = api.toggle;
					close = () => api.open && api.toggle();
					return (
						<button
							type="button"
							class="v3-app-more"
							ref={api.ref}
							data-on={api.open || undefined}
							aria-haspopup="menu"
							aria-expanded={api.open}
							aria-label={m.panel_app_more({ title: props.app.title })}
							onClick={(event) => {
								event.stopPropagation();
								props.onPick();
								api.toggle();
							}}
						>
							<Icon of={Ellipsis} size={15} />
						</button>
					);
				}}
			>
				<button type="button" role="menuitem" data-row data-flat="true" onClick={() => menu(() => act("show"))}>
					<Icon of={Maximize2} size={15} class="row-icon" />
					<span class="row-label">{m.panel_show_on_canvas()}</span>
				</button>
				<button type="button" role="menuitem" data-row data-flat="true" disabled={!running()} onClick={() => menu(() => window.open(`/app/${props.app.name}/`, "_blank", "noopener"))}>
					<Icon of={ArrowUpRight} size={15} class="row-icon" />
					<span class="row-label">{m.panel_open_new_tab()}</span>
				</button>
				<div class="rule" aria-hidden="true" />
				<Show
					when={running() || status() === "stopping"}
					fallback={
						<button type="button" role="menuitem" data-row data-flat="true" disabled={moving()} onClick={() => menu(() => act("start"))}>
							<Icon of={Play} size={15} class="row-icon" />
							<span class="row-label">{m.panel_app_start()}</span>
						</button>
					}
				>
					<button type="button" role="menuitem" data-row data-flat="true" disabled={moving()} onClick={() => menu(() => act("stop"))}>
						<Icon of={Square} size={15} class="row-icon" />
						<span class="row-label">{m.panel_app_stop()}</span>
					</button>
				</Show>
				<button type="button" role="menuitem" data-row data-flat="true" onClick={() => menu(() => act("reload"))}>
					<Icon of={RefreshCw} size={15} class="row-icon" />
					<span class="row-label">{m.panel_reload()}</span>
				</button>
				<button type="button" role="menuitem" data-row data-flat="true" disabled={!running() || moving()} onClick={() => menu(() => act("restart"))}>
					<Icon of={RotateCcw} size={15} class="row-icon" />
					<span class="row-label">{m.panel_app_restart()}</span>
				</button>
				<button type="button" role="menuitem" data-row data-flat="true" onClick={() => menu(props.onLogs)}>
					<Icon of={Terminal} size={15} class="row-icon" />
					<span class="row-label">{m.panel_app_logs()}</span>
				</button>
				<div class="rule" aria-hidden="true" />
				<button type="button" role="menuitem" data-row data-flat="true" class="menu-danger" onClick={() => menu(() => act("delete"))}>
					<Icon of={Trash2} size={15} class="row-icon" />
					<span class="row-label">{m.panel_delete_ellipsis()}</span>
				</button>
			</Popover>
		</div>
	);
}

/**
 * An app's recent output, in a small panel over the canvas's lower right, read again every two
 * seconds while it is open. Closed by its × or Escape.
 */
export function AppLogs(props: { title: string; read: () => Promise<string[] | undefined>; onClose: () => void }) {
	const [lines, setLines] = createSignal<string[]>();
	let pre: HTMLPreElement | undefined;
	const load = () =>
		void props.read().then((got) => {
			const end = pre ? pre.scrollHeight - pre.scrollTop - pre.clientHeight < 8 : true;
			setLines(got ?? []);
			if (end && pre) queueMicrotask(() => pre && (pre.scrollTop = pre.scrollHeight));
		});
	load();
	const timer = setInterval(load, 2000);
	const onKey = (event: KeyboardEvent) => {
		if (event.key === "Escape") props.onClose();
	};
	window.addEventListener("keydown", onKey);
	onCleanup(() => {
		clearInterval(timer);
		window.removeEventListener("keydown", onKey);
	});
	return (
		<Portal>
			<div class="v3-app-logs" role="dialog" aria-label={m.panel_app_logs_of({ title: props.title })}>
				<div class="v3-app-logs-head">
					<Icon of={Terminal} size={14} />
					<span class="truncate">{props.title}</span>
					<span class="flex-1" />
					<button type="button" class="v3-app-logs-x" aria-label={m.panel_app_logs_close()} onClick={props.onClose}>
						<Icon of={X} size={14} />
					</button>
				</div>
				<pre ref={pre}>{lines() === undefined ? m.panel_reading() : lines()!.length ? lines()!.join("\n") : m.panel_nothing_yet()}</pre>
			</div>
		</Portal>
	);
}
