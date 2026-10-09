import { api } from "../connections/connection.ts";
import type { LucideIcon } from "lucide-solid";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import File from "lucide-solid/icons/file";
import FileCode from "lucide-solid/icons/file-code";
import FileAudio from "lucide-solid/icons/file-audio";
import FileArchive from "lucide-solid/icons/file-archive";
import FileImage from "lucide-solid/icons/file-image";
import FileSpreadsheet from "lucide-solid/icons/file-spreadsheet";
import Presentation from "lucide-solid/icons/presentation";
import FileText from "lucide-solid/icons/file-text";
import FileType from "lucide-solid/icons/file-type";
import FileVideo from "lucide-solid/icons/file-video";
import Folder from "lucide-solid/icons/folder";
import HardDrive from "lucide-solid/icons/hard-drive";
import Search from "lucide-solid/icons/search";
import Upload from "lucide-solid/icons/upload";
import X from "lucide-solid/icons/x";
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Icon } from "../ui/icons.tsx";

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

/** What the picker is for, said in its title and under it. */
const PURPOSES = {
	canvas: { title: "Add a file", sub: "Documents open as pages you and your agents type into; pictures, films and sounds go on the canvas; anything else gets a board." },
	attach: { title: "Attach a file", sub: "It goes into your message, for the agent to read." },
	embed: { title: "Choose a file", sub: "It is shown on the board, where it is." },
} as const;

/**
 * Choosing a file: to embed in a board, or, with `onGoogle`, to open as a document page.
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
 *
 * One dialog for every way in — the canvas's File button, the composer's paperclip, a board's
 * embed — showing every kind of file, each row saying which kind it is, with a filter for a long
 * folder. With `onGoogle` it has a second tab for a Google Doc, which only the canvas can open.
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
	/** For a document: a Google Doc by its address instead of a file (`google/docs.ts` on the server). */
	onGoogle?: (url: string) => void;
	/** What the file is for, which the title and the line under it say. */
	purpose?: keyof typeof PURPOSES;
}) {
	const documents = () => !!props.onGoogle;
	const words = () => PURPOSES[props.purpose ?? "embed"];
	const [tab, setTab] = createSignal<"files" | "google">(documents() && localStorage.getItem("decks.picker.tab") === "google" ? "google" : "files");
	const choose = (next: "files" | "google") => {
		setTab(next);
		localStorage.setItem("decks.picker.tab", next);
	};

	/*
	 * Signing in to Google happens here, where a Doc's link is pasted: a Doc's page cannot be made
	 * until the server can read the Doc. With a Desktop client Google sends the browser to a
	 * loopback address that does not load, and that address is pasted back.
	 */
	const [google, { refetch: recheck }] = createResource(
		documents,
		async () => (await (await fetch(api("/google/status"))).json()) as { mode: string; client: boolean; signedIn: boolean; email?: string; paste?: boolean; comments?: boolean },
	);
	const signedIn = () => !!google()?.signedIn;

	/*
	 * The person's own Docs, the ones they looked at last first, narrowed by name as they type. What is
	 * typed can also be a Doc's address, which is opened as it is, for a Doc shared by a link and never
	 * opened in this account. A sign-in older than Drive access cannot list anything: it says so, and
	 * signing in again fixes it, while a pasted address still works.
	 */
	const [query, setQuery] = createSignal("");
	const [asked, setAsked] = createSignal("");
	let typing: ReturnType<typeof setTimeout> | undefined;
	const ask = (text: string) => {
		setQuery(text);
		clearTimeout(typing);
		typing = setTimeout(() => setAsked(text.trim()), 250);
	};
	onCleanup(() => clearTimeout(typing));
	const pasted = () => linkedDoc(query());
	const [docs, { refetch: relist }] = createResource(
		() => (tab() === "google" && signedIn() && !pasted() ? { q: asked() } : false),
		async ({ q }) => {
			const response = await fetch(api(`/google/docs${q ? `?q=${encodeURIComponent(q)}` : ""}`));
			const body = (await response.json().catch(() => ({}))) as { docs?: GoogleListed[]; error?: string };
			if (!response.ok) throw new Error(body.error ?? `Google answered ${response.status}.`);
			return body.docs ?? [];
		},
	);
	// Back from signing in, in another tab: ask again.
	onMount(() => {
		const back = () => {
			if (tab() !== "google") return;
			void recheck();
			if (signedIn()) void relist();
		};
		window.addEventListener("focus", back);
		onCleanup(() => window.removeEventListener("focus", back));
	});
	const stale = () => /insufficient authentication scopes/i.test(String(docs.error ?? ""));
	const [returned, setReturned] = createSignal("");
	const [said, setSaid] = createSignal("");
	const signIn = () => window.open(`${api("/google/signin")}?origin=${encodeURIComponent(location.origin)}`, "_blank", "noopener");
	const finish = async () => {
		const answer = (await (await fetch(api("/google/code"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: returned().trim() }) })).json()) as { ok: boolean; email?: string; message?: string };
		setSaid(answer.ok ? `Signed in as ${answer.email}.` : (answer.message ?? "That did not work."));
		if (answer.ok) void recheck();
	};

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
		const url = path ? api(`/browse?path=${encodeURIComponent(path)}`) : api("/browse");
		const response = await fetch(url);
		if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
		return (await response.json()) as BrowseResult;
	});
	const [filter, setFilter] = createSignal("");
	const go = (path: string) => {
		setFilter("");
		setAt(path);
	};

	/** Folders first, then files, then the filter. */
	const rows = createMemo(() => {
		const typed = filter().trim().toLowerCase();
		// A film's poster and a file's preview are the server's pictures of them (`files/media.ts`, `files/preview.ts`), not files anyone put there.
		return (listing()?.entries ?? []).filter((entry) => !/\.(poster\.jpg|preview\.png)$/i.test(entry.name) && (!typed || entry.name.toLowerCase().includes(typed))).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "dir" ? -1 : 1));
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

	onMount(() => {
		const key = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			props.onCancel();
		};
		window.addEventListener("keydown", key);
		onCleanup(() => window.removeEventListener("keydown", key));
	});

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
			<div class="panel-float picker static" role="dialog" aria-modal="true" aria-label={words().title}>
				<header class="picker-head">
					<div class="picker-titles">
						<span class="picker-title">{words().title}</span>
						<span class="picker-sub">{words().sub}</span>
					</div>
					<button class="icon-button [--control:28px]" type="button" title="Close (Esc)" aria-label="Close" onClick={props.onCancel}>
						<Icon of={X} size={16} />
					</button>
				</header>

				<Show when={documents()}>
					<div class="picker-tabs" role="tablist" aria-label="Where the file is">
						<button type="button" role="tab" aria-selected={tab() === "files"} data-on={tab() === "files" ? "true" : undefined} onClick={() => choose("files")}>
							<Icon of={HardDrive} size={14} />
							Files
						</button>
						<button type="button" role="tab" aria-selected={tab() === "google"} data-on={tab() === "google" ? "true" : undefined} onClick={() => choose("google")}>
							<GoogleDocMark size={14} />
							Google Docs
						</button>
					</div>
				</Show>

				<Show when={tab() === "files"}>
					<div class="picker-bar">
						<button class="icon-button [--control:28px]" type="button" title="Up one folder" aria-label="Up one folder" disabled={!at()} onClick={() => go(listing()?.parent ?? "")}>
							<Icon of={ChevronLeft} size={16} />
						</button>
						<div class="picker-path" title={listing()?.path || "The deck and the folders it may reach"}>
							<button type="button" class="picker-crumb" onClick={() => go("")}>
								All places
							</button>
							<Show when={at() && listing()?.path}>
								{(path) => (
									<>
										<Icon of={ChevronRight} size={13} class="text-faint" />
										<span class="picker-here">
											<bdi>{path()}</bdi>
										</span>
									</>
								)}
							</Show>
						</div>
						<label class="picker-filter">
							<Icon of={Search} size={14} class="text-faint" />
							<input
								type="text"
								placeholder="Filter"
								aria-label="Filter this folder"
								value={filter()}
								onInput={(event) => setFilter(event.currentTarget.value)}
								onKeyDown={(event) => {
									const only = rows().length === 1 ? rows()[0] : undefined;
									if (event.key !== "Enter" || !only) return;
									if (only.kind === "dir") go(only.path);
									else props.onPick(only.path);
								}}
							/>
						</label>
					</div>

					<div class="picker-list" role="listbox" aria-label="Files">
						<Show when={listing.error}>
							<div class="picker-empty">{String(listing.error)}</div>
						</Show>
						<For
							each={rows()}
							fallback={
								<Show when={!listing.error && !listing.loading}>
									<div class="picker-empty">{filter() ? `Nothing here matches “${filter()}”.` : "This folder is empty."}</div>
								</Show>
							}
						>
							{(entry) => {
								const kind = kindOf(entry);
								return (
									<button type="button" role="option" class="picker-row" onClick={() => (entry.kind === "dir" ? go(entry.path) : props.onPick(entry.path))}>
										<span class="picker-tile" data-tone={kind.tone}>
											<Icon of={kind.icon} size={15} />
										</span>
										<span class="picker-name" title={entry.name}>{entry.kind === "file" ? withoutExtension(entry.name) : entry.name}</span>
										<span class="picker-kind">{entry.kind === "dir" ? "" : kind.label}</span>
										<span class="picker-size">{entry.kind === "dir" ? <Icon of={ChevronRight} size={14} /> : sizeOf(entry.size)}</span>
									</button>
								);
							}}
						</For>
					</div>

					<footer class="picker-foot">
						<span class="picker-hint">{((n) => (n === 0 ? "" : n === 1 ? "1 file here" : `${n} files here`))(rows().filter((row) => row.kind === "file").length)}</span>
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
							<button class="btn" type="button" title="Copy a file or photo from this device into the deck" disabled={adding()} onClick={() => input.click()}>
								<Icon of={Upload} size={14} />
								{adding() ? "Adding…" : "Upload from this device"}
							</button>
						</Show>
					</footer>
				</Show>

				<Show when={tab() === "google" && signedIn()}>
					<div class="picker-bar">
						<label class="picker-filter picker-filter-wide">
							<Icon of={Search} size={14} class="text-faint" />
							<input
								type="text"
								autocomplete="off"
								placeholder="Search your Docs, or paste a link"
								aria-label="Search your Google Docs, or paste a Doc's link"
								value={query()}
								ref={(el) => requestAnimationFrame(() => el.focus())}
								onInput={(event) => ask(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key !== "Enter") return;
									const first = pasted() ? query().trim() : docs()?.[0]?.id;
									if (first) props.onGoogle?.(first);
								}}
							/>
						</label>
					</div>

					<div class="picker-list" role="listbox" aria-label="Google Docs">
						<Show when={pasted()}>
							<button type="button" role="option" class="picker-row" onClick={() => props.onGoogle?.(query().trim())}>
								<span class="picker-tile" data-tone="blue">
									<GoogleDocMark size={16} />
								</span>
								<span class="picker-name">Open the Doc at this link</span>
								<span class="picker-kind" />
								<span class="picker-size">
									<Icon of={ChevronRight} size={14} />
								</span>
							</button>
						</Show>
						<Show when={!pasted()}>
							<Show when={docs.error}>
								<div class="picker-empty picker-google-stale">
									<Show when={stale()} fallback={String(docs.error?.message ?? docs.error)}>
										<span>This sign-in can open a Doc by its link, but not list your Docs.</span>
										<button class="picker-google-signin" type="button" onClick={signIn}>
											<GoogleG />
											Sign in again to see your Docs
										</button>
										<Show when={google()?.paste}>
											<form
												class="picker-google-form"
												onSubmit={(event) => {
													event.preventDefault();
													if (returned().trim()) void finish().then(() => relist());
												}}
											>
												<input
													class="picker-google-input"
													type="text"
													autocomplete="off"
													placeholder="Then paste the address the browser ended on"
													aria-label="Address after signing in"
													value={returned()}
													onInput={(event) => setReturned(event.currentTarget.value)}
												/>
												<button class="btn" data-primary="true" type="submit" disabled={!returned().trim()}>
													Done
												</button>
											</form>
										</Show>
										<Show when={said()}>
											<span>{said()}</span>
										</Show>
									</Show>
								</div>
							</Show>
							<For
								each={docs.error ? [] : (docs() ?? [])}
								fallback={
									<Show when={!docs.error && !docs.loading}>
										<div class="picker-empty">{asked() ? `No Doc's name has “${asked()}” in it.` : "No Google Docs in this account yet."}</div>
									</Show>
								}
							>
								{(doc) => (
									<button type="button" role="option" class="picker-row" title={doc.title} onClick={() => props.onGoogle?.(doc.id)}>
										<span class="picker-tile" data-tone="blue">
											<GoogleDocMark size={16} />
										</span>
										<span class="picker-name">{doc.title}</span>
										<span class="picker-kind">{doc.owner ? `Shared by ${doc.owner}` : ""}</span>
										<span class="picker-size">{editedOn(doc.modified)}</span>
									</button>
								)}
							</For>
						</Show>
					</div>

					<footer class="picker-foot">
						<span class="picker-hint">
							<span class="picker-dot" aria-hidden="true" />
							{google()?.mode === "fake" ? "Stand-in Docs on this server" : `Signed in${google()?.email ? ` as ${google()?.email}` : ""}`}
						</span>
						<span class="picker-hint">Your typing reaches Google within a couple of seconds.</span>
					</footer>
				</Show>

				<Show when={tab() === "google" && !signedIn()}>
					<div class="picker-google">
						<GoogleDocMark size={36} />
						<Show when={google()} fallback={<p class="picker-google-note">Asking the server about Google…</p>}>
							{(state) => (
								<Show
									when={state().client}
									fallback={
										<>
											<p class="picker-google-title">Google isn't set up on this server</p>
											<p class="picker-google-note">Put your Google Cloud project's OAuth client file at google/client.json in the server's data folder, then come back here to sign in.</p>
										</>
									}
								>
									<>
										<p class="picker-google-title">Sign in to open a Google Doc</p>
										<p class="picker-google-note">Decks reads and writes the Doc as you. The sign-in is kept on this server.</p>
										<button class="picker-google-signin" type="button" onClick={signIn}>
											<GoogleG />
											Sign in with Google
										</button>
										<Show when={state().paste}>
											<form
												class="picker-google-form"
												onSubmit={(event) => {
													event.preventDefault();
													if (returned().trim()) void finish();
												}}
											>
												<input
													class="picker-google-input"
													type="text"
													autocomplete="off"
													placeholder="Then paste the address the browser ended on"
													aria-label="Address after signing in"
													value={returned()}
													onInput={(event) => setReturned(event.currentTarget.value)}
												/>
												<button class="btn" data-primary="true" type="submit" disabled={!returned().trim()}>
													Done
												</button>
											</form>
										</Show>
										<Show when={said()}>
											<p class="picker-google-note">{said()}</p>
										</Show>
									</>
								</Show>
							)}
						</Show>
					</div>
				</Show>
			</div>
		</div>
	);
}

/** A Doc in the person's Drive (`/api/google/docs`). */
interface GoogleListed {
	id: string;
	title: string;
	modified?: string;
	owner?: string;
}

/** A Google Doc's address, or its bare id, as pasted: the Doc is opened as it is, listed or not. */
function linkedDoc(text: string): string | undefined {
	const trimmed = text.trim();
	return /docs\.google\.com\/document\/(?:u\/\d+\/)?d\/[\w-]{20,}/.test(trimmed) || /^[\w-]{30,}$/.test(trimmed) ? trimmed : undefined;
}

/** When a Doc was last changed, short: the time today, the day this year, the date before that. */
function editedOn(iso: string | undefined): string {
	if (!iso) return "";
	const when = new Date(iso);
	if (Number.isNaN(when.getTime())) return "";
	const now = new Date();
	if (when.toDateString() === now.toDateString()) return when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
	if (when.getFullYear() === now.getFullYear()) return when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
	return when.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** A Google Doc, drawn as a blue page: what the tab and the card are about, not Google's own logo. */
function GoogleDocMark(props: { size: number }) {
	return (
		<svg class="picker-docmark" width={props.size} height={props.size} viewBox="0 0 24 24" aria-hidden="true">
			<path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill="#4285f4" />
			<path d="M14 2v5h5" fill="#a1c2fa" />
			<path d="M8 12h8M8 15h8M8 18h5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" />
		</svg>
	);
}

/** The four-colour G a "Sign in with Google" button carries, as Google's branding asks. */
function GoogleG() {
	return (
		<svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
			<path fill="#ea4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5Z" />
			<path fill="#4285f4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.1Z" />
			<path fill="#fbbc05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1Z" />
			<path fill="#34a853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48Z" />
		</svg>
	);
}

/** A file's name as a person says it: the kind beside it already says Markdown, PDF or Video. */
function withoutExtension(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

function extensionOf(name: string): string {
	return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
}

function sizeOf(bytes: number | undefined): string {
	if (bytes === undefined) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * What kind of thing a row is: an icon, a word and a tint.
 *
 * The families are the ones `board.js` sorts an embed into — prose, picture, markup, PDF,
 * plain text and source — plus the kinds a document page opens, so a row answers "what will
 * this be" rather than naming a filetype.
 */
function kindOf(entry: BrowseEntry): { icon: LucideIcon; label: string; tone: string } {
	if (entry.kind === "dir") return { icon: Folder, label: "Folder", tone: "folder" };
	const extension = extensionOf(entry.name);
	if (["md", "markdown", "mdx"].includes(extension)) return { icon: FileText, label: "Markdown", tone: "blue" };
	if (["tex", "bib", "sty", "cls", "ltx"].includes(extension)) return { icon: FileCode, label: "LaTeX", tone: "green" };
	if (extension === "docx") return { icon: FileText, label: "Word", tone: "indigo" };
	if (["txt", "text", "rst", "org"].includes(extension)) return { icon: FileText, label: "Text", tone: "grey" };
	if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(extension)) return { icon: FileImage, label: "Image", tone: "amber" };
	if (["html", "htm", "xhtml"].includes(extension)) return { icon: FileCode, label: "Web page", tone: "grey" };
	if (extension === "pdf") return { icon: FileType, label: "PDF", tone: "red" };
	if (["xlsx", "xls", "ods", "numbers"].includes(extension)) return { icon: FileSpreadsheet, label: "Spreadsheet", tone: "green" };
	if (["pptx", "ppt", "key", "odp"].includes(extension)) return { icon: Presentation, label: "Presentation", tone: "amber" };
	if (["zip", "tar", "gz", "tgz", "7z", "rar"].includes(extension)) return { icon: FileArchive, label: "Archive", tone: "grey" };
	if (["csv", "tsv"].includes(extension)) return { icon: FileSpreadsheet, label: "Table", tone: "green" };
	if (["mp4", "m4v", "webm", "mov", "ogv", "mkv"].includes(extension)) return { icon: FileVideo, label: "Video", tone: "violet" };
	if (["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "weba"].includes(extension)) return { icon: FileAudio, label: "Audio", tone: "violet" };
	// Text and source both render as escaped preformatted text on a board, so they
	// share an icon with markup rather than with prose: what you get is the source.
	if (PREFORMATTED.has(extension)) return { icon: FileCode, label: extension.toUpperCase(), tone: "grey" };
	return { icon: File, label: extension ? extension.toUpperCase() : "File", tone: "grey" };
}

/** The extensions `board.js` renders as preformatted text; see its `TEXTUAL` list. */
const PREFORMATTED = new Set([
	"txt", "text", "log", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "ini", "cfg", "conf", "env",
	"ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "c", "h", "cc", "cpp", "hpp",
	"cs", "swift", "php", "sh", "bash", "zsh", "fish", "sql", "css", "scss", "less", "diff", "patch",
]);
