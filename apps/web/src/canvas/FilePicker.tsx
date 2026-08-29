import type { LucideIcon } from "lucide-solid";
import ChevronUp from "lucide-solid/icons/chevron-up";
import File from "lucide-solid/icons/file";
import FileCode from "lucide-solid/icons/file-code";
import FileImage from "lucide-solid/icons/file-image";
import FileText from "lucide-solid/icons/file-text";
import FileType from "lucide-solid/icons/file-type";
import Folder from "lucide-solid/icons/folder";
import { createResource, createSignal, For, Show } from "solid-js";
import { Icon } from "../icons.tsx";

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
	/*
	 * `""` and not `undefined`, which is the whole reason the picker used to open empty.
	 *
	 * `createResource` treats a source of `null`, `undefined` or `false` as "not ready
	 * yet" and does not call the fetcher at all, so a picker whose starting position was
	 * `undefined` never asked for the roots — and since every way to move is a click on a
	 * row it never had, there was no way out of the empty state either. The empty string
	 * is a real position, meaning "wherever `/api/browse` starts", which is what the URL
	 * below already assumed.
	 */
	const [at, setAt] = createSignal<string>("");
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
								<Icon of={ChevronUp} size={14} />
								up
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
								<Icon of={iconFor(entry)} class="glyph" size={16} />
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

/**
 * What kind of thing a row is, said in one icon.
 *
 * The picker already knows the extension, and a directory that looked like `▸` beside a
 * file that looked like `·` was very nearly no information at all. The families are the
 * ones `board.js` sorts an embed into — prose, picture, markup, PDF, plain text and
 * source — so a row's icon answers "what will this look like on the board" rather than
 * naming a filetype, and anything outside them gets the plain file the board falls back
 * to: a chip naming it, which is still a component and still opens.
 */
function iconFor(entry: BrowseEntry): LucideIcon {
	if (entry.kind === "dir") return Folder;
	const extension = entry.name.slice(entry.name.lastIndexOf(".") + 1).toLowerCase();
	if (["md", "markdown", "mdx"].includes(extension)) return FileText;
	if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(extension)) return FileImage;
	if (["html", "htm", "xhtml"].includes(extension)) return FileCode;
	if (extension === "pdf") return FileType;
	// Text and source both render as escaped preformatted text on a board, so they
	// share an icon with markup rather than with prose: what you get is the source.
	if (PREFORMATTED.has(extension)) return FileCode;
	return File;
}

/** The extensions `board.js` renders as preformatted text; see its `TEXTUAL` list. */
const PREFORMATTED = new Set([
	"txt", "text", "log", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "ini", "cfg", "conf", "env",
	"ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "c", "h", "cc", "cpp", "hpp",
	"cs", "swift", "php", "sh", "bash", "zsh", "fish", "sql", "css", "scss", "less", "diff", "patch",
]);
