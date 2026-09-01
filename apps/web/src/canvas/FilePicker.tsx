import type { LucideIcon } from "lucide-solid";
import ChevronUp from "lucide-solid/icons/chevron-up";
import Upload from "lucide-solid/icons/upload";
import File from "lucide-solid/icons/file";
import FileCode from "lucide-solid/icons/file-code";
import FileImage from "lucide-solid/icons/file-image";
import FileText from "lucide-solid/icons/file-text";
import FileType from "lucide-solid/icons/file-type";
import Folder from "lucide-solid/icons/folder";
import { createResource, createSignal, For, Show } from "solid-js";
import { Icon } from "../icons.tsx";

/** Where you are, and where you would be if there were nothing here: the same quiet grey. */
const WHERE = "overflow-hidden font-mono text-[11px] text-ellipsis whitespace-nowrap text-faint";
const EMPTY = "p-2.5 text-[11px] text-faint";

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
 *
 * **And it is the way in for a file that is not in the deck yet.** Dropping one from the
 * desktop (§6.9) is impossible on a phone — there is no desktop and no drag — while the
 * upload route and the insert path it feeds already existed, so what was missing was
 * somewhere to tap. `<input type="file">` is that somewhere, and on a phone the platform
 * answers it with the camera and the photo library as well as the file browser, which is
 * three routes for one control and none of them ours to build.
 */
export function FilePicker(props: {
	onPick: (path: string) => void;
	onCancel: () => void;
	/**
	 * Copy this into the deck and answer with the path a board should point at.
	 *
	 * One file, because one embed is what the caller asked for: the picker is opened to
	 * answer "what does this component point at", and a batch belongs to the drop path
	 * (§6.9), which lays several out in a row rather than in a pile.
	 */
	onAdd?: (file: File) => Promise<string | undefined>;
}) {
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

	const [adding, setAdding] = createSignal(false);
	let input!: HTMLInputElement;

	const add = async (file: File | undefined) => {
		if (!file || !props.onAdd) return;
		setAdding(true);
		try {
			const picked = await props.onAdd(file);
			// A refused upload leaves the picker open on purpose: the notice says why, and
			// closing on failure would take the browsing position away with it.
			if (picked) props.onPick(picked);
		} finally {
			setAdding(false);
		}
	};

	/*
	 * Dismissed by a press that *begins* on the backdrop, not by a click on it.
	 *
	 * A click was the obvious thing and on a touchscreen it closed the picker the instant
	 * it opened. The tap that asked for a file is one gesture that produces two events —
	 * the `pointerdown` the editor acts on, and a `click` at the same coordinates
	 * afterwards — and by the time the click arrives the backdrop has appeared under
	 * exactly that point. A press is the honest test of intent: a ghost click has no
	 * `pointerdown` of its own, because its `pointerdown` happened before this existed.
	 */
	return (
		<div
			class="picker-backdrop"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) props.onCancel();
			}}
		>
			{/* Wide enough to read a path on a laptop, never wider than the screen. */}
			<div class="panel-float picker static flex max-h-[70%] w-[min(520px,calc(100vw-24px))] flex-col p-0">
				<header class="flex items-center gap-2 border-b border-line px-2.5 py-2">
					<Show when={listing()?.parent} fallback={<span class={WHERE}>roots</span>}>
						{(parent) => (
							<button
								class="flex items-center gap-[3px] py-[3px] pr-[9px] pl-1.5 text-[11px] pointer-coarse:min-h-[38px]"
								type="button"
								onClick={() => setAt(parent())}
							>
								<Icon of={ChevronUp} size={14} />
								up
							</button>
						)}
					</Show>
					<span class={WHERE}>{listing()?.path || "the deck and its roots"}</span>
					<Show when={props.onAdd}>
						{/*
							Hidden input, visible button: a file input styles as whatever the
							platform feels like and cannot be given an icon, and the label-wrapping
							trick loses the keyboard focus ring. The button is the affordance and
							the input is the mechanism.
						*/}
						<input
							ref={input}
							// Clipped rather than `display: none`, which would take it out of the
							// accessibility tree along with the button that drives it.
							class="pointer-events-none absolute h-px w-px overflow-hidden opacity-0 [clip-path:inset(50%)]"
							type="file"
							onChange={(event) => {
								const file = event.currentTarget.files?.[0];
								event.currentTarget.value = "";
								void add(file);
							}}
						/>
						<button
							class="add ml-auto flex items-center gap-[3px] py-[3px] pr-[9px] pl-1.5 text-[11px] whitespace-nowrap disabled:cursor-default disabled:text-faint pointer-coarse:min-h-[38px]"
							type="button"
							title="Copy a file or photo from this device into the deck"
							disabled={adding()}
							onClick={() => input.click()}
						>
							<Icon of={Upload} size={14} />
							{adding() ? "adding…" : "from this device"}
						</button>
					</Show>
				</header>

				<div class="overflow-y-auto p-1.5">
					<Show when={listing.error}>
						<div class={EMPTY}>{String(listing.error)}</div>
					</Show>
					<For each={listing()?.entries ?? []} fallback={<div class={EMPTY}>nothing here</div>}>
						{(entry) => (
							<button
								type="button"
								class="entry flex w-full cursor-pointer items-center gap-2 rounded-control border-0 bg-none px-2 py-[5px] text-left text-[12px] text-inherit hover:bg-line pointer-coarse:min-h-11"
								onClick={() => (entry.kind === "dir" ? setAt(entry.path) : props.onPick(entry.path))}
							>
								{/* The kind of thing a row is, in the same grey as the size on the other end. */}
								<Icon of={iconFor(entry)} class="text-faint" size={16} />
								<span class="flex-1">{entry.name}</span>
								<Show when={entry.size !== undefined}>
									<span class="text-[11px] text-faint">{Math.max(1, Math.round((entry.size ?? 0) / 1024))} KB</span>
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
