import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
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
 * So there is one 120ms fade and nothing else. Opening a stage is a *click*: the panel closes and
 * the camera lands on the middle of that stage's work (`camera.middleOf`).
 *
 * ### The card
 *
 * A picture of the whole stage, taken by the server once per revision (`/api/stage-thumb`), and
 * one line under it: the name, and the faces of whoever has it open. The count of boards and
 * "you are here" are in the card's tooltip and in its border — a second line would have said what
 * the border already says.
 */
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

	const rows = createMemo(() => searchStages(props.stages, query()));
	const found = createMemo(() => rows().filter((one) => one.hit).length);
	const searching = () => query().trim() !== "";

	const open = (name: string) => {
		props.onPick(name);
		props.onClose();
	};

	return (
		<Show when={props.open}>
			{/*
				The scrim is what makes this a panel rather than a menu: the canvas is still there,
				quieter. A press on it closes, which is the other half of Escape.
			*/}
			<div class="stage-manager" role="dialog" aria-label="Stages" onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}>
				<div class="float stage-box">
					<div class="stage-head">
						<label class="field h-8 min-w-0 flex-1 gap-1.5 rounded-lg pointer-coarse:h-10">
							<Icon of={Search} class="flex-none text-faint" size={13} />
							<input
								ref={field}
								type="text"
								spellcheck={false}
								class="min-w-0 flex-1 border-0 bg-none text-ui text-fg outline-none placeholder:text-faint pointer-coarse:text-[16px]"
								placeholder={`Search ${props.stages.length} stage${props.stages.length === 1 ? "" : "s"}`}
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
							{found()} of {props.stages.length}
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
								<button
									type="button"
									class="stage-card"
									data-name={row.stage.name}
									data-here={row.stage.name === props.here ? "true" : undefined}
									data-dim={row.hit ? undefined : "true"}
									data-hit={searching() && row.hit ? "true" : undefined}
									title={`${row.stage.name} — ${row.stage.boards} board${row.stage.boards === 1 ? "" : "s"}${
										row.stage.name === props.here ? ", you are here" : row.stage.agents.length === 0 ? ", nobody here" : ""
									}`}
									onClick={() => open(row.stage.name)}
								>
									{/*
										The picture is the stage as the server drew it, cached by the drawing's
										revision — so an unchanged stage is never redrawn, and a changed one
										cannot show yesterday. A stage nobody has drawn on has no picture and
										shows the plain tile, which is the truth about it.
									*/}
									<img class="stage-shot" src={`/api/stage-thumb/${encodeURIComponent(row.stage.name)}?v=${row.stage.rev}&scheme=${props.scheme}`} alt="" loading="lazy" />
									<span class="stage-foot">
										<span class="row-label">{row.stage.name}</span>
										<span class="stage-faces">
											<For each={row.stage.agents}>
												{(agent) => (
													<AgentFace
														chat={{ id: agent.id, name: agent.name, kind: "claude", state: "idle" } as never}
														identity={{ name: agent.name, color: agent.color }}
														size={16}
														ring={0}
													/>
												)}
											</For>
										</span>
									</span>
								</button>
							)}
						</For>
					</div>
				</div>
			</div>
		</Show>
	);
}
