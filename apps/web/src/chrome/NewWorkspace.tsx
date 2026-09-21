import Plus from "lucide-solid/icons/plus";
import { createSignal } from "solid-js";
import { Popover } from "../ui/Popover.tsx";
import { Icon } from "../ui/icons.tsx";

/**
 * The **New workspace** button, on both dashboard tabs.
 *
 * A workspace exists by being named — there is no registry — so making one means making
 * the first thing that carries the name: a canvas, filed under it and named after it, the
 * same room `session.setWorkspace` gives an agent moving into a project with no room yet.
 * The name is typed into a small popover off the button rather than a dialog: it is one
 * word, and the shelf it will head is right there. Enter makes it; Escape or a click away
 * forgets it.
 *
 * The same outlined button as **New canvas** (`.canvas-new`), because it is the same kind
 * of act one level up, and two shapes for "make one of these" would be a rule to learn.
 */
export function NewWorkspace(props: { onCreate: (name: string) => void; class?: string }) {
	const [name, setName] = createSignal("");
	let dismiss: (() => void) | undefined;
	const commit = () => {
		const wanted = name().trim();
		if (!wanted) return;
		props.onCreate(wanted);
		setName("");
		dismiss?.();
	};
	return (
		<Popover
			placement="bottom-end"
			class="canvas-menu w-[240px]"
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
			<label class="canvas-menu-name">
				<span class="nt">Workspace</span>
				<input
					class="field"
					type="text"
					placeholder="political-llm"
					value={name()}
					spellcheck={false}
					autofocus
					onInput={(event) => setName(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						event.preventDefault();
						commit();
					}}
				/>
				<span class="nt">⏎ makes it, with its first canvas. Slugged and cut at 24 characters.</span>
			</label>
		</Popover>
	);
}
