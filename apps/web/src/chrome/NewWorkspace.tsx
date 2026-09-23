import { onMount, Show } from "solid-js";
import { workspaceSlug } from "../lib/slug.ts";

/**
 * A name for a new workspace: one field and one button.
 *
 * The agent window's picker names a new workspace with it. Enter and the button do the same thing, so nothing has to say ⏎; the one
 * rule (the server slugs the name and cuts it at 24 characters) is shown as feedback rather
 * than stated: *Named political-llm* appears under the field the moment what was typed and
 * what it becomes differ, and a name that already is a slug shows nothing.
 */
export function WorkspaceField(props: { value: string; onInput: (value: string) => void; onCreate: () => void; autofocus?: boolean }) {
	const slugged = () => workspaceSlug(props.value);
	let field: HTMLInputElement | undefined;
	onMount(() => {
		if (props.autofocus) requestAnimationFrame(() => field?.focus());
	});
	return (
		<div class="ws-new">
			<div class="ws-new-line">
				<label class="field h-8 min-w-0 flex-1 gap-1.5 rounded-md">
					<input
						ref={field}
						type="text"
						class="min-w-0 flex-1 border-0 bg-none text-ui text-fg outline-none placeholder:text-faint"
						placeholder="Name"
						aria-label="Workspace name"
						spellcheck={false}
						value={props.value}
						onInput={(event) => props.onInput(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							props.onCreate();
						}}
					/>
				</label>
				<button type="button" class="ws-new-create" disabled={slugged() === ""} onClick={props.onCreate}>
					Create
				</button>
			</div>
			<Show when={slugged() !== "" && slugged() !== props.value.trim()}>
				<p class="ws-new-slug">
					Named <code>{slugged()}</code>
				</p>
			</Show>
		</div>
	);
}
