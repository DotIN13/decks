import { createResource, createSignal, For, Show } from "solid-js";

interface BrowseEntry {
	name: string;
	path: string;
	kind: "dir" | "file";
	size?: number;
}

interface BrowseResult {
	path: string;
	parent: string | null;
	entries: BrowseEntry[];
}

/**
 * Choosing a file to embed.
 *
 * It browses exactly what `/api/file` will serve — the deck, and the roots declared
 * in `deck.json` — because a picker that can reach further than the route offers you
 * a file and then a broken embed.
 */
export function FilePicker(props: { onPick: (path: string) => void; onCancel: () => void }) {
	const [at, setAt] = createSignal<string | undefined>(undefined);
	const [listing] = createResource(at, async (path) => {
		const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : "/api/browse";
		const response = await fetch(url);
		if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
		return (await response.json()) as BrowseResult;
	});

	return (
		<div class="picker-backdrop" onClick={() => props.onCancel()}>
			<div class="panel-float picker" onClick={(event) => event.stopPropagation()}>
				<header>
					<Show when={listing()?.parent} fallback={<span class="where">roots</span>}>
						{(parent) => (
							<button type="button" onClick={() => setAt(parent())}>
								↑ up
							</button>
						)}
					</Show>
					<span class="where">{listing()?.path || "the deck and its roots"}</span>
				</header>

				<div class="entries">
					<Show when={listing.error}>
						<div class="empty">{String(listing.error)}</div>
					</Show>
					<For each={listing()?.entries ?? []} fallback={<div class="empty">nothing here</div>}>
						{(entry) => (
							<button
								type="button"
								class="entry"
								onClick={() => (entry.kind === "dir" ? setAt(entry.path) : props.onPick(entry.path))}
							>
								<span class="glyph">{entry.kind === "dir" ? "▸" : "·"}</span>
								<span class="name">{entry.name}</span>
								<Show when={entry.size !== undefined}>
									<span class="size">{Math.max(1, Math.round((entry.size ?? 0) / 1024))} KB</span>
								</Show>
							</button>
						)}
					</For>
				</div>
			</div>
		</div>
	);
}
