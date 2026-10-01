import { onCleanup, onMount, Show } from "solid-js";
import { question } from "../state/confirm.ts";

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
						<div class="panel-float static flex w-[min(420px,calc(100vw-32px))] flex-col gap-2 bg-bg px-4 py-3.5" role="alertdialog" aria-label={q().title}>
							<div class="font-semibold">{q().title}</div>
							<div class="text-ui leading-normal whitespace-pre-wrap text-muted">{q().body}</div>
							<div class="mt-1 flex justify-end gap-1.5">
								<button class="btn" type="button" onClick={() => q().answer(false)}>
									{q().no}
								</button>
								<button class="btn" type="button" data-primary="true" ref={yes} onClick={() => q().answer(true)}>
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
