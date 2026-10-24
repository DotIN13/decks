import { onCleanup, onMount, Show } from "solid-js";
import Trash2 from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import { question, type Question } from "../state/confirm.ts";
import { Icon } from "./icons.tsx";

/** Whether the answer removes something. */
const danger = (q: Question) => q.danger ?? /^(delete|remove|forget)\b/i.test(q.yes);

/** The app's one yes-or-no question (`state/confirm.ts`), over everything, answered with a press or Enter and Escape. */
export function ConfirmDialog() {
	return (
		<Show when={question()}>
			{(q) => {
				let yes: HTMLButtonElement | undefined;
				onMount(() => {
					yes?.focus();
					const key = (event: KeyboardEvent) => {
						if (event.key === "Escape") {
							event.preventDefault();
							q().answer(false);
						}
					};
					addEventListener("keydown", key, true);
					onCleanup(() => removeEventListener("keydown", key, true));
				});
				return (
					<div
						class="picker-backdrop confirm-backdrop"
						onPointerDown={(event) => {
							// A press that begins on the backdrop says no, as the other sheets' backdrops do.
							if (event.target === event.currentTarget) q().answer(false);
						}}
					>
						<div class="confirm-dlg" role="alertdialog" aria-label={q().title}>
							{/* The drawn confirm: the title by a bin when it removes, the words, then the buttons on a line of their own. */}
							<div class="confirm-head">
								<Show when={danger(q())}>
									<span class="confirm-icon" aria-hidden="true">
										<Icon of={Trash2} size={15} />
									</span>
								</Show>
								<span class="confirm-title">{q().title}</span>
								<span class="flex-1" />
								<button class="confirm-x" type="button" aria-label="Close" onClick={() => q().answer(false)}>
									<Icon of={X} size={16} />
								</button>
							</div>
							<div class="confirm-body">{q().body}</div>
							<div class="confirm-foot">
								<button class="btn" type="button" onClick={() => q().answer(false)}>
									{q().no}
								</button>
								<button class="btn" type="button" data-primary="true" data-danger={danger(q()) ? "true" : undefined} ref={yes} onClick={() => q().answer(true)}>
									{q().yes}
								</button>
							</div>
						</div>
					</div>
				);
			}}
		</Show>
	);
}
