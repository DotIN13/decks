import Plus from "lucide-solid/icons/plus";
import { createSignal, onMount, Show } from "solid-js";
import { Popover } from "../ui/Popover.tsx";
import { Icon } from "../ui/icons.tsx";
import { workspaceSlug } from "../lib/slug.ts";

/**
 * A name for a new workspace: one field and one button.
 *
 * Shared by the dashboard's **New workspace** button, the canvas menu's *Move to → New
 * workspace…* and the agent window's picker, so a workspace is named the same way wherever
 * it is named. Enter and the button do the same thing, so nothing has to say ⏎; the one
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
						class="min-w-0 flex-1 border-0 bg-none text-[12px] text-fg outline-none placeholder:text-faint"
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

/**
 * The **New workspace** button, on both dashboard tabs.
 *
 * A workspace exists by being named — there is no registry — so making one means making
 * the first thing that carries the name: a canvas, filed under it and named after it, the
 * same room `session.setWorkspace` gives an agent moving into a project with no room yet.
 * The name is typed into a small popover off the button rather than a dialog: it is one
 * word, and the shelf it will head is right there. What it makes is shown rather than told:
 * the new heading and its first canvas appear on the shelf.
 *
 * The same outlined button as **New canvas** (`.canvas-new`), because it is the same kind
 * of act one level up, and two shapes for "make one of these" would be a rule to learn.
 */
export function NewWorkspace(props: { onCreate: (name: string) => void; class?: string }) {
	const [name, setName] = createSignal("");
	let dismiss: (() => void) | undefined;
	const commit = () => {
		const wanted = name().trim();
		if (!wanted || workspaceSlug(wanted) === "") return;
		props.onCreate(wanted);
		setName("");
		dismiss?.();
	};
	return (
		<Popover
			placement="bottom-end"
			class="canvas-menu w-[272px]"
			label="New workspace"
			onOpenChange={(open) => {
				if (!open) setName("");
			}}
			trigger={(api) => {
				dismiss = () => {
					if (api.open) api.toggle();
				};
				return (
					<button
						ref={api.ref}
						type="button"
						class={`canvas-new ${props.class ?? ""}`}
						aria-haspopup="dialog"
						aria-expanded={api.open}
						title="A new workspace, with its first canvas"
						onClick={api.toggle}
					>
						<Icon of={Plus} size={12} />
						New workspace
					</button>
				);
			}}
		>
			<WorkspaceField value={name()} onInput={setName} onCreate={commit} autofocus />
		</Popover>
	);
}
