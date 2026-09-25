import Lock from "lucide-solid/icons/lock";
import Pencil from "lucide-solid/icons/pencil";
import Trash from "lucide-solid/icons/trash-2";
import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { StageRow } from "@decks/protocol";
import { Icon } from "../ui/icons.tsx";
import { searchStages } from "../state/stages.ts";
import { AgentFace } from "../agents/AgentPill.tsx";

/**
 * The stage manager: every stage in the deck, as cards, in a panel over the canvas.
 *
 * A stage is a folder of work — its boards and its drawing — and until this there was no way for
 * a person to see that more than one existed, let alone move between them. An agent could
 * (`stage.stages`, `stage.open`); the browser was never told.
 *
 * ### Why a panel and not the canvas itself
 *
 * It was drawn as a wall that the canvas zoomed out into, your own stage shrinking into its place
 * among the others. That is the better picture and the worse build: it needs two bespoke
 * transitions, and a transition that has to be perfect to be understood at all is a liability. A
 * panel is a thing this app already has, and it states what is true — you are choosing, and the
 * work you are choosing from is still there behind it.
 *
 * So there is one 120ms fade, in and out, and nothing else. Opening a stage is a *click*: the panel closes and
 * the camera lands on the middle of that stage's work (`camera.middleOf`).
 *
 * ### The card
 *
 * A picture of the whole stage, taken by the server once per revision (`/api/stage-thumb`), and
 * one line under it: the name, and the faces of whoever has it open. The count of boards and
 * "you are here" are in the card's tooltip, and the pill already names the stage you are on — a
 * second line, or a dark border, would have said it again.
 */
/** The panel's fade, in and out: `stages.css` says the same 120ms. */
const FADE_MS = 120;

/** A transparent pixel: what a card shows in place of a picture that could not be had. */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export function StageManager(props: {
	stages: StageRow[];
	/** The stage the conversation on screen is on, so its card is marked. */
	here: string | undefined;
	open: boolean;
	onClose: () => void;
	/** Put the agent you are talking to on this stage. */
	onPick: (name: string) => void;
	/** Make a stage from a name, and open it. */
	onNew: (title: string) => void;
	scheme: "light" | "dark";
	/** The agent is isolated: only isolated stages are offered, since those are all it may open. */
	isolated?: boolean;
	/** Rename a stage; the server makes the name folder-safe and refuses one that is taken. */
	onRename: (name: string, to: string) => void;
	/** Delete a stage, with its drawing and any boards kept in its own folder. */
	onDelete: (name: string) => void;
}) {
	const [query, setQuery] = createSignal("");
	let field: HTMLInputElement | undefined;

	/* Opening is where the query is cleared and the field takes the keyboard: a manager that
	   opened on last week's search would be a manager that lies about how many stages there are. */
	createEffect(() => {
		if (!props.open) return;
		setQuery("");
		queueMicrotask(() => field?.focus());
	});

	/*
	 * Mounted is not the same as open: the panel fades out as it fades in, so it stays in the
	 * page until its opacity has reached 0. `shown` goes a frame after mounting, so the fade in
	 * has an opacity of 0 to start from.
	 *
	 * The unmount is on a timer, not on `transitionend`. A close that lands before the fade in
	 * has moved cancels the transition rather than finishing it, no `transitionend` comes, and
	 * the panel stayed in the page, invisible, with the keyboard still in its field.
	 */
	const [mounted, setMounted] = createSignal(false);
	const [shown, setShown] = createSignal(false);
	createEffect(() => {
		if (props.open) {
			setMounted(true);
			requestAnimationFrame(() =>
				requestAnimationFrame(() => {
					// Closed again before it ever showed: there is no fade to wait for.
					if (props.open) {
						setShown(true);
						// Again, now the field is certainly in the page: the microtask above can run
						// before the panel has mounted, and then Escape has nowhere to go.
						field?.focus();
					} else setMounted(false);
				}),
			);
		} else {
			setShown(false);
			const gone = setTimeout(() => !props.open && setMounted(false), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : FADE_MS + 40);
			onCleanup(() => clearTimeout(gone));
		}
	});

	/* Escape closes it wherever the keyboard is, not only from the field: a tap on a card's gap
	   on a phone, or a click on the count, takes focus out of the field. */
	createEffect(() => {
		if (!props.open) return;
		const escape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			event.preventDefault();
			props.onClose();
		};
		document.addEventListener("keydown", escape);
		onCleanup(() => document.removeEventListener("keydown", escape));
	});

	/* Isolated, the isolated stages are the whole list: the server refuses the rest anyway. */
	const offered = createMemo(() => (props.isolated ? props.stages.filter((stage) => stage.isolated) : props.stages));
	const rows = createMemo(() => searchStages(offered(), query()));
	const found = createMemo(() => rows().filter((one) => one.hit).length);
	const searching = () => query().trim() !== "";

	const open = (name: string) => {
		props.onPick(name);
		props.onClose();
	};

	return (
		<Show when={mounted()}>
			{/*
				The scrim is what makes this a panel rather than a menu: the canvas is still there,
				quieter. A press on it closes, which is the other half of Escape.
			*/}
			<div
				class="stage-manager"
				role="dialog"
				aria-label="Stages"
				data-open={shown() ? "true" : undefined}
				onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}
			>
				<div class="float stage-box">
					<div class="stage-head">
						<label class="field h-8 min-w-0 flex-1 gap-1.5 rounded-lg pointer-coarse:h-10">
							<Icon of={Search} class="flex-none text-faint" size={13} />
							<input
								ref={field}
								type="text"
								spellcheck={false}
								class="min-w-0 flex-1 border-0 bg-none text-ui text-fg outline-none placeholder:text-faint pointer-coarse:text-[16px]"
								placeholder={`Search ${offered().length} ${props.isolated ? "isolated " : ""}stage${offered().length === 1 ? "" : "s"}`}
								value={query()}
								onInput={(event) => setQuery(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										event.preventDefault();
										if (query()) setQuery("");
										else props.onClose();
										return;
									}
									// The commonest search is two letters and the one answer: Enter opens it.
									if (event.key !== "Enter") return;
									const first = rows().find((one) => one.hit);
									if (first) open(first.stage.name);
								}}
							/>
						</label>
						<span class="stage-count tabular-nums">
							{found()} of {offered().length}
						</span>
						<button
							type="button"
							class="icon-button"
							title="New stage"
							aria-label="New stage"
							onClick={() => {
								const title = window.prompt("Name the new stage");
								if (title?.trim()) {
									props.onNew(title.trim());
									props.onClose();
								}
							}}
						>
							<Icon of={Plus} size={15} />
						</button>
					</div>

					<div class="stage-wall">
						<For each={rows()}>
							{(row) => (
								<StageCard
									row={row}
									here={props.here}
									searching={searching()}
									scheme={props.scheme}
									onOpen={open}
									onRename={props.onRename}
									onDelete={props.onDelete}
								/>
							)}
						</For>
					</div>
				</div>
			</div>
		</Show>
	);
}

/**
 * One stage in the manager: its picture, which opens it, and a line with its name, who is on it,
 * and two quiet controls — rename, which edits the name where it is drawn, and delete, which asks
 * once in its own place before it does anything.
 */
function StageCard(props: {
	row: { stage: StageRow; hit: boolean };
	here: string | undefined;
	searching: boolean;
	scheme: "light" | "dark";
	onOpen: (name: string) => void;
	onRename: (name: string, to: string) => void;
	onDelete: (name: string) => void;
}) {
	const [editing, setEditing] = createSignal(false);
	const [confirming, setConfirming] = createSignal(false);
	const stage = () => props.row.stage;
	let input: HTMLInputElement | undefined;
	/* An edit ends once: taking the field away can blur it, and that blur must not rename again. */
	let settled = true;
	const startEditing = () => {
		settled = false;
		setEditing(true);
	};
	const commit = () => {
		if (settled) return;
		settled = true;
		const to = input?.value.trim() ?? "";
		setEditing(false);
		if (to && to !== stage().name) props.onRename(stage().name, to);
	};
	const cancel = () => {
		settled = true;
		setEditing(false);
	};

	return (
		<div
			class="stage-card"
			data-name={stage().name}
			data-here={stage().name === props.here ? "true" : undefined}
			data-dim={props.row.hit ? undefined : "true"}
			data-hit={props.searching && props.row.hit ? "true" : undefined}
			title={`${stage().name} — ${stage().boards} board${stage().boards === 1 ? "" : "s"}${stage().name === props.here ? ", you are here" : stage().agents.length === 0 ? ", nobody here" : ""}`}
			onClick={() => !editing() && props.onOpen(stage().name)}
			onPointerLeave={() => setConfirming(false)}
		>
			{/*
				The picture is the stage as the server drew it, cached by the drawing's revision — so an
				unchanged stage is never redrawn, and a changed one cannot show yesterday.
			*/}
			<button type="button" class="stage-open" aria-label={`Open ${stage().name}`}>
				<img
					class="stage-shot"
					src={`/api/stage-thumb/${encodeURIComponent(stage().name)}?v=${stage().rev}&scheme=${props.scheme}`}
					alt=""
					loading="lazy"
					/*
					 * No picture — an empty stage has nothing to draw, and a stage that went away since
					 * the list was sent has no page — is the plain tile, never a broken image: a
					 * transparent pixel keeps the card's ground and shape.
					 */
					onError={(event) => {
						if (!event.currentTarget.src.startsWith("data:")) event.currentTarget.src = BLANK;
					}}
				/>
				{/* Copied back from an isolated stage when isolation ended: on the picture's corner, at a glance. */}
				<Show when={stage().fromIsolation}>
					<span class="stage-badge" title="Copied back from an isolated stage when isolation ended">
						<Icon of={Lock} size={11} />
						Isolated
					</span>
				</Show>
			</button>
			<span class="stage-foot">
				<Show when={editing()} fallback={<span class="row-label">{stage().name}</span>}>
					<input
						ref={(element) => {
							input = element;
							queueMicrotask(() => {
								element.focus();
								element.select();
							});
						}}
						class="stage-rename"
						value={stage().name}
						spellcheck={false}
						aria-label={`New name for ${stage().name}`}
						onClick={(event) => event.stopPropagation()}
						onKeyDown={(event) => {
							// Handled here, so Escape cancels the rename rather than closing the manager.
							if (event.key === "Enter") {
								event.preventDefault();
								commit();
							} else if (event.key === "Escape") {
								event.preventDefault();
								event.stopPropagation();
								cancel();
							}
						}}
						onBlur={commit}
					/>
				</Show>
				<span class="stage-faces">
					<For each={stage().agents}>
						{(agent) => <AgentFace chat={{ id: agent.id, name: agent.name, kind: "claude", state: "idle" } as never} identity={{ name: agent.name, color: agent.color }} size={16} ring={0} />}
					</For>
				</span>
				<span class="stage-acts" onClick={(event) => event.stopPropagation()}>
					<Show
						when={confirming()}
						fallback={
							<>
								<button type="button" class="icon-button" title="Rename" aria-label={`Rename ${stage().name}`} onClick={startEditing}>
									<Icon of={Pencil} size={13} />
								</button>
								<button type="button" class="icon-button" title="Delete" aria-label={`Delete ${stage().name}`} onClick={() => setConfirming(true)}>
									<Icon of={Trash} size={13} />
								</button>
							</>
						}
					>
						<button
							type="button"
							class="stage-confirm"
							title="Deletes the stage, its drawing and any boards kept in its own folder. The deck's own boards stay."
							onClick={() => {
								setConfirming(false);
								props.onDelete(stage().name);
							}}
						>
							Delete
						</button>
					</Show>
				</span>
			</span>
		</div>
	);
}
