import Copy from "lucide-solid/icons/copy";
import LayoutDashboard from "lucide-solid/icons/layout-dashboard";
import Pencil from "lucide-solid/icons/pencil";
import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import Trash from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import { createSignal, For, Show, type JSX } from "solid-js";
import { Icon } from "@decks/ui";
import { AgentFace } from "../../agents/AgentPill.tsx";
import { api } from "../../connections/connection.ts";
import { AuthedImg } from "../../lib/authed.tsx";
import type { StageRow } from "../../state/types/index.ts";
import { createCardEdit, createManager, type ManagerProps } from "./actions.ts";
import { cardMeta, type Row } from "./model.ts";

// The canvas manager: every canvas in the deck, over the canvas, with a search,
// an order, a new canvas named in place, and each card's rename and delete.

type M = { m: ReturnType<typeof createManager>; props: ManagerProps };

function NewCanvas(p: M): JSX.Element {
	const m = p.m;
	return (
		<Show
			when={m.naming()}
			fallback={
				<button type="button" class="stage-new" onClick={() => m.setNaming(true)}>
					<Icon of={Plus} size={14} />
					New canvas
				</button>
			}
		>
			<form class="stage-new-form" onSubmit={(event) => (event.preventDefault(), m.create())}>
				<input
					ref={(element) => {
						m.fields.name = element;
						queueMicrotask(() => element.focus());
					}}
					class="stage-new-field"
					placeholder="Name the new canvas"
					spellcheck={false}
					onKeyDown={(event) => {
						if (event.key !== "Escape") return;
						event.preventDefault();
						event.stopPropagation();
						m.setNaming(false);
						m.fields.search?.focus();
					}}
				/>
				<button type="submit" class="stage-new">Create</button>
				<button type="button" class="stage-icon" aria-label="Cancel" onClick={() => m.setNaming(false)}>
					<Icon of={X} size={14} />
				</button>
			</form>
		</Show>
	);
}

function Tools(p: M): JSX.Element {
	const m = p.m;
	const key = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			event.preventDefault();
			if (m.query()) m.setQuery("");
			else p.props.onClose();
			return;
		}
		const first = event.key === "Enter" ? m.ordered()[0] : undefined;
		if (first) m.open(first.stage.name);
	};
	return (
		<div class="stage-tools">
			<label class="stage-search">
				<Icon of={Search} class="flex-none text-faint" size={15} />
				<input ref={(element) => (m.fields.search = element)} type="text" spellcheck={false} placeholder="Find a canvas" title="Matches a canvas's name, the words on its cards and notes, and who is on it" value={m.query()} onInput={(event) => m.setQuery(event.currentTarget.value)} onKeyDown={key} />
				<Show when={m.searching() && m.found() > 0}>
					<kbd class="stage-kbd">↵</kbd>
				</Show>
			</label>
			<div class="segmented stage-sort" role="radiogroup" aria-label="Order">
				<button type="button" role="radio" aria-checked={m.sort() === "recent"} data-on={m.sort() === "recent"} onClick={() => m.setSort("recent")}>
					Recent
				</button>
				<button type="button" role="radio" aria-checked={m.sort() === "az"} data-on={m.sort() === "az"} onClick={() => m.setSort("az")}>
					A–Z
				</button>
			</div>
		</div>
	);
}

export function CanvasManager(props: ManagerProps): JSX.Element {
	const m = createManager(props);
	return (
		<Show when={m.mounted()}>
			<div class="stage-manager" role="dialog" aria-label="Canvases" data-open={m.shown() ? "true" : undefined} onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}>
				<div class="stage-box">
					<div class="stage-head">
						<div class="stage-title-row">
							<h2 class="stage-title">Canvases</h2>
							<NewCanvas m={m} props={props} />
						</div>
						<Tools m={m} props={props} />
					</div>
					<div class="stage-wall">
						<For each={m.ordered()}>{(row) => <CanvasCard row={row} here={props.here} searching={m.searching()} scheme={props.scheme} onOpen={m.open} onRename={props.onRename} onDelete={props.onDelete} {...(props.onCopy ? { onCopy: props.onCopy } : {})} />}</For>
						<Show when={m.searching() && m.found() === 0}>
							<p class="stage-none">No canvas matches “{m.query().trim()}”.</p>
						</Show>
					</div>
				</div>
			</div>
		</Show>
	);
}

type CardProps = { row: Row; here: string | undefined; searching: boolean; scheme: "light" | "dark"; onOpen: (name: string) => void; onRename: (name: string, to: string) => void; onDelete: (name: string) => void; onCopy?: (name: string) => void };
type C = { props: CardProps; e: ReturnType<typeof createCardEdit>; canvas: () => StageRow };

function Picture(p: C): JSX.Element {
	const [broken, setBroken] = createSignal(false);
	const canvas = p.canvas;
	return (
		<button type="button" class="stage-open" aria-label={`Open ${canvas().title}`}>
			<Show
				when={canvas().boards > 0 && !broken()}
				fallback={
					<span class="stage-empty">
						<Icon of={LayoutDashboard} size={22} />
						<span>{canvas().boards > 0 ? "No picture yet" : "Empty canvas"}</span>
					</span>
				}
			>
				<AuthedImg class="stage-shot" src={api(`/stage-thumb/${encodeURIComponent(canvas().name)}?v=${canvas().rev}&scheme=${p.props.scheme}`)} alt="" loading="lazy" onError={() => setBroken(true)} onLoad={(event) => event.currentTarget.setAttribute("data-loaded", "")} />
			</Show>
			<Show when={canvas().name === p.props.here}>
				<span class="sr-only">Current</span>
			</Show>
		</button>
	);
}

function Acts(p: C): JSX.Element {
	const { e, canvas } = p;
	const title = () => canvas().title;
	return (
		<span class="stage-acts" data-confirming={e.confirming() ? "true" : undefined} onClick={(event) => event.stopPropagation()}>
			<Show
				when={e.confirming()}
				fallback={
					<>
						<Show when={canvas().shared && p.props.onCopy}>
							<button type="button" class="stage-icon" title="Make a copy" aria-label={`Make a copy of ${title()}`} onClick={() => p.props.onCopy?.(canvas().name)}>
								<Icon of={Copy} size={13} />
							</button>
						</Show>
						<Show when={canvas().shared?.role !== "view"}>
							<button type="button" class="stage-icon" title="Rename" aria-label={`Rename ${title()}`} onClick={e.start}>
								<Icon of={Pencil} size={13} />
							</button>
						</Show>
						<button type="button" class="stage-icon" title="Delete" aria-label={`Delete ${title()}`} onClick={() => e.setConfirming(true)}>
							<Icon of={Trash} size={13} />
						</button>
					</>
				}
			>
				<button type="button" class="stage-icon" aria-label="Keep it" onClick={() => e.setConfirming(false)}>
					<Icon of={X} size={13} />
				</button>
				<button type="button" class="stage-confirm" title="Deletes the canvas, its drawing and the cards kept in its own folder." onClick={() => (e.setConfirming(false), p.props.onDelete(canvas().name))}>
					Delete canvas
				</button>
			</Show>
		</span>
	);
}

function Foot(p: C): JSX.Element {
	const { e, canvas } = p;
	const key = (event: KeyboardEvent) => {
		if (event.key === "Enter") (event.preventDefault(), e.commit());
		else if (event.key === "Escape") (event.preventDefault(), event.stopPropagation(), e.cancel());
	};
	const focus = (element: HTMLInputElement) => {
		e.edit.input = element;
		queueMicrotask(() => (element.focus(), element.select()));
	};
	return (
		<span class="stage-foot">
			<span class="stage-name-row">
				<Show when={e.editing()} fallback={<span class="row-label">{canvas().title}</span>}>
					<input ref={focus} class="stage-rename" value={canvas().title} spellcheck={false} aria-label={`New name for ${canvas().title}`} onClick={(event) => event.stopPropagation()} onKeyDown={key} onBlur={e.commit} />
				</Show>
				<span class="stage-faces">
					<For each={canvas().agents}>{(agent) => <AgentFace chat={{ id: agent.id, name: agent.name, kind: "claude", state: "idle" } as never} identity={{ name: agent.name, color: agent.color }} size={18} ring={0} />}</For>
				</span>
			</span>
			<span class="stage-meta">{cardMeta(canvas())}</span>
		</span>
	);
}

function CanvasCard(props: CardProps): JSX.Element {
	const canvas = () => props.row.stage;
	const e = createCardEdit({ canvas, onRename: props.onRename });
	const here = () => canvas().name === props.here;
	const meta = () => cardMeta(canvas());
	return (
		<div class="stage-card" data-name={canvas().name} data-here={here() ? "true" : undefined} title={`${canvas().title}: ${meta()}${here() ? ", you are here" : canvas().agents.length === 0 ? ", nobody on it" : ""}`} onClick={() => !e.editing() && props.onOpen(canvas().name)} onPointerLeave={() => e.setConfirming(false)}>
			<Picture props={props} e={e} canvas={canvas} />
			<Acts props={props} e={e} canvas={canvas} />
			<Foot props={props} e={e} canvas={canvas} />
		</div>
	);
}
