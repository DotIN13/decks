import ChevronDown from "lucide-solid/icons/chevron-down";
import Download from "lucide-solid/icons/download";
import FileUp from "lucide-solid/icons/file-up";
import Pencil from "lucide-solid/icons/pencil";
import Plug from "lucide-solid/icons/plug";
import X from "lucide-solid/icons/x";
import { createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { DecksMark, Icon } from "../ui/icons.tsx";
import { Popover } from "../ui/Popover.tsx";
import { state } from "../state/deck.ts";
import { stageOf } from "../state/stages.ts";
import { backend, can } from "./backend.ts";
import { forget, openBundle } from "./bundle.ts";
import { active, api, connections, nameOf, newId, rename, saveConnections, switchTo, type Connection } from "./connection.ts";
import { available, ensureWorker, reach } from "./worker.ts";

/**
 * The connection switcher: the top of the left panel, where the deck's mark was.
 *
 * It names what this tab is on, and pressing it lists every backend this browser knows: this
 * server, servers it has paired with, and canvases opened from a file. Picking one loads the page
 * on it (`switchTo`). Under the list are the two ways to add one and, on a backend that can share,
 * the way to take the canvas on screen away as a file.
 */
type Reach = "ok" | "off" | "unpaired";

/**
 * What was typed, as an address: `jules.example.ts.net` → `https://…`, while `localhost:4329`, an
 * IP address and a one-word name like `jules` keep plain http, which is what a Decks on a laptop or
 * a home network serves. A scheme typed is kept as typed.
 */
export function serverBase(typed: string): string {
	const text = typed.trim().replace(/\/+$/, "");
	if (/^https?:\/\//i.test(text)) return text;
	const host = text.replace(/[:/].*$/, "");
	const plain = /^localhost$/i.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host) || text.startsWith("[") || !host.includes(".") || /\.local$/i.test(host);
	return `${plain ? "http" : "https"}://${text}`;
}

async function reachable(one: Connection): Promise<Reach> {
	if (one.kind !== "server") return "ok";
	try {
		const response = await fetch(`${one.base.replace(/\/+$/, "")}/api/hello`, { headers: { Authorization: `Bearer ${one.token}` }, mode: "cors", credentials: "omit", signal: AbortSignal.timeout(4000) });
		if (!response.ok) return "off";
		const said = (await response.json()) as { paired?: boolean };
		return said.paired === false ? "unpaired" : "ok";
	} catch {
		return "off";
	}
}

function kindNote(one: Connection): string {
	if (one.kind === "here") return location.host;
	if (one.kind === "server") return new URL(one.base).host;
	return `file · ${one.boards} board${one.boards === 1 ? "" : "s"}`;
}

export function Switcher(props: { label?: string } = {}) {
	const [view, setView] = createSignal<"list" | "connect">("list");
	const [reached, setReached] = createSignal<Record<string, Reach>>({});
	const [error, setError] = createSignal<string | undefined>();
	const [busy, setBusy] = createSignal(false);
	const [address, setAddress] = createSignal("");
	const [code, setCode] = createSignal("");
	const [label, setLabel] = createSignal("");
	let picker: HTMLInputElement | undefined;

	const current = () => active();
	/** This server's own name, which only its greeting says: known while the tab is on it. */
	const ownName = () => backend()?.name ?? state.deck?.name;
	const name = () => {
		const one = current();
		return one ? nameOf(one, ownName() ?? "Decks") : "Decks";
	};
	/** A row's name: yours for it, or its own; "This server" for the page's own when another is open. */
	const rowName = (one: Connection) => nameOf(one, current()?.kind === "here" ? ownName() : undefined);

	/** The row being renamed, and what is typed so far. */
	const [editing, setEditing] = createSignal<string | undefined>();
	const [draftName, setDraftName] = createSignal("");
	const startRename = (one: Connection) => {
		setDraftName(rowName(one));
		setEditing(one.id);
	};
	const finishRename = (keep: boolean) => {
		const id = editing();
		if (!id) return;
		setEditing(undefined);
		if (!keep) return;
		const one = connections().find((each) => each.id === id);
		// Typing the backend's own name back is clearing yours.
		const own = one?.kind === "here" ? ownName() : one?.label;
		rename(id, draftName().trim() === own ? "" : draftName());
	};
	const stage = () => stageOf(state.focused);

	const opened = (open: boolean) => {
		if (!open) {
			setView("list");
			setError(undefined);
			return;
		}
		for (const one of connections()) void reachable(one).then((answer) => setReached((was) => ({ ...was, [one.id]: answer })));
	};

	const go = async (id: string) => {
		if (id === current()?.id) return;
		const one = connections().find((each) => each.id === id);
		if (one) {
			try {
				await reach(one);
			} catch (failed) {
				setError((failed as Error).message);
				return;
			}
		}
		switchTo(id);
	};

	const connect = async (event: Event) => {
		event.preventDefault();
		setError(undefined);
		let base: string;
		try {
			base = serverBase(address());
			new URL(base);
		} catch {
			setError("That is not an address.");
			return;
		}
		setBusy(true);
		try {
			const response = await fetch(`${base}/api/pair`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code: code(), label: `Decks at ${location.host}` }),
				mode: "cors",
				credentials: "omit",
			});
			const said = (await response.json().catch(() => ({}))) as { token?: string; name?: string; error?: string };
			if (!response.ok || !said.token) throw new Error(said.error ?? `The server answered ${response.status}.`);
			const id = newId();
			const given = label().replace(/\s+/g, " ").trim().slice(0, 60);
			saveConnections([...connections(), { id, kind: "server", label: said.name ?? new URL(base).host, ...(given ? { name: given } : {}), base, token: said.token, added: Date.now() }]);
			await go(id);
		} catch (failed) {
			const text = (failed as Error).message;
			setError(text === "Failed to fetch" || text.startsWith("NetworkError") ? `Could not reach ${base}. It must be a Decks server on HTTPS (or localhost) that this browser can reach.` : text);
		} finally {
			setBusy(false);
		}
	};

	const openFile = async (file: File | undefined) => {
		if (!file) return;
		setError(undefined);
		if (!available()) {
			setError("Opening a canvas file needs this page on HTTPS or localhost.");
			return;
		}
		setBusy(true);
		try {
			await ensureWorker();
			const id = await openBundle(file);
			await go(id);
		} catch (failed) {
			setError((failed as Error).message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			{/* In the body rather than the panel: the panel's one field is its search, and stays so. */}
			<Portal>
				<input ref={picker} type="file" accept=".decks,application/zip" class="hidden" data-bundle-input onChange={(event) => void openFile(event.currentTarget.files?.[0])} />
			</Portal>
			<Popover
				placement="bottom-start"
				label="Connections"
				class="switcher-card w-[280px]"
				onOpenChange={opened}
				trigger={(popover) => (
					<button
						type="button"
						class="switcher"
						ref={popover.ref}
						aria-haspopup="menu"
						aria-expanded={popover.open}
						data-on={popover.open ? "soft" : undefined}
						title="Switch between servers and canvas files"
						onClick={popover.toggle}
					>
						<span class="panel-mark-glyph" aria-hidden="true">
							<DecksMark size={14} />
						</span>
						<span class="switcher-name">{props.label ?? name()}</span>
						<Show when={current()?.kind === "bundle"}>
							<span class="switcher-tag">read only</span>
						</Show>
						<Icon of={ChevronDown} size={12} class="flex-none text-faint" />
					</button>
				)}
			>
				<Show
					when={view() === "list"}
					fallback={
						<form class="switcher-form" onSubmit={(event) => void connect(event)}>
							{/*
								The panel search's own field (`LeftPanel.tsx`): `.field` at 32px, the input inside it
								borderless, 16px on a touch keyboard so focusing it does not zoom the page.
							*/}
							<div class="switcher-label">
								<span>Server address</span>
								<label class="field h-8 flex-none rounded-lg pointer-coarse:h-10 pointer-coarse:px-2.5">
									<input
										type="text"
										inputmode="url"
										autocomplete="off"
										spellcheck={false}
										class="min-w-0 flex-1 border-0 bg-none text-ui text-fg outline-none placeholder:text-faint pointer-coarse:text-[16px]"
										placeholder="localhost:4329"
										value={address()}
										onInput={(event) => setAddress(event.currentTarget.value)}
										data-connect-address
									/>
								</label>
							</div>
							<div class="switcher-label">
								<span>
									Pairing code <span class="text-faint">· only over the internet</span>
								</span>
								<label class="field h-8 flex-none rounded-lg pointer-coarse:h-10 pointer-coarse:px-2.5">
									<input
										type="text"
										inputmode="numeric"
										autocomplete="one-time-code"
										maxLength={6}
										class="min-w-0 flex-1 border-0 bg-none text-ui tracking-[0.12em] text-fg outline-none placeholder:tracking-normal placeholder:text-faint pointer-coarse:text-[16px]"
										placeholder="From that server's Settings"
										value={code()}
										onInput={(event) => setCode(event.currentTarget.value)}
										data-connect-code
									/>
								</label>
							</div>
							<div class="switcher-label">
								<span>
									Name <span class="text-faint">· optional</span>
								</span>
								<label class="field h-8 flex-none rounded-lg pointer-coarse:h-10 pointer-coarse:px-2.5">
									<input
										type="text"
										autocomplete="off"
										maxLength={60}
										class="min-w-0 flex-1 border-0 bg-none text-ui text-fg outline-none placeholder:text-faint pointer-coarse:text-[16px]"
										placeholder="What the server calls itself"
										value={label()}
										onInput={(event) => setLabel(event.currentTarget.value)}
										data-connect-name
									/>
								</label>
							</div>
							<Show when={error()}>{(text) => <p class="switcher-error">{text()}</p>}</Show>
							<div class="switcher-actions">
								<button type="button" class="btn" onClick={() => setView("list")}>
									Back
								</button>
								<button type="submit" class="btn" data-primary="true" disabled={busy() || !address().trim()}>
									{busy() ? "Connecting…" : "Connect"}
								</button>
							</div>
						</form>
					}
				>
					<div class="row-list" role="menu">
						<For each={connections()}>
							{(one) => (
								<div class="row-act" data-on={one.id === current()?.id ? "true" : undefined}>
									<Show
										when={editing() === one.id}
										fallback={
											<>
												<button type="button" role="menuitem" data-row data-flat="true" class="min-w-0 flex-1" data-connection={one.id} onClick={() => void go(one.id)}>
													<span class="switcher-dot" data-reach={one.id === current()?.id ? "ok" : (reached()[one.id] ?? "unknown")} aria-hidden="true" />
													<span class="flex min-w-0 flex-1 flex-col items-start">
														<span class="row-label w-full truncate text-left">{rowName(one)}</span>
														<span class="row-note w-full truncate text-left text-faint">
															{kindNote(one)}
															{one.name && one.kind !== "here" && one.name !== one.label ? ` · ${one.label}` : ""}
															{reached()[one.id] === "off" ? " · not reachable" : reached()[one.id] === "unpaired" ? " · pairing revoked" : ""}
														</span>
													</span>
												</button>
												<button type="button" class="close" title="Rename" aria-label={`Rename ${rowName(one)}`} onClick={() => startRename(one)} data-rename={one.id}>
													<Icon of={Pencil} size={12} />
												</button>
												<Show when={one.kind !== "here" && one.id !== current()?.id}>
													<button type="button" class="close" title={one.kind === "bundle" ? "Remove this canvas from this browser" : "Forget this server"} aria-label={`Forget ${rowName(one)}`} onClick={() => void forget(one.id)}>
														<Icon of={X} size={12} />
													</button>
												</Show>
											</>
										}
									>
										{/*
											Renaming in the row itself. Its keys stop here: the menu listens on the document
											for Escape and the arrows, and they mean the text while it is being typed.
										*/}
										<label class="field switcher-rename h-8 min-w-0 flex-1 rounded-lg pointer-coarse:h-10 pointer-coarse:px-2.5">
											<input
												ref={(el) => requestAnimationFrame(() => (el.focus(), el.select()))}
												type="text"
												maxLength={60}
												class="min-w-0 flex-1 border-0 bg-none text-ui text-fg outline-none placeholder:text-faint pointer-coarse:text-[16px]"
												placeholder={one.kind === "here" ? (ownName() ?? "This server") : one.label}
												value={draftName()}
												onInput={(event) => setDraftName(event.currentTarget.value)}
												/* `on:` binds to the field itself; Solid's `onKeyDown` is delegated to the
												   document, where the menu's own listener would already have the key. */
												on:keydown={(event: KeyboardEvent) => {
													event.stopPropagation();
													if (event.key === "Enter") finishRename(true);
													else if (event.key === "Escape") finishRename(false);
												}}
												onBlur={() => finishRename(true)}
												data-rename-input
											/>
										</label>
									</Show>
								</div>
							)}
						</For>
					</div>
					<div class="rule" aria-hidden="true" />
					<button type="button" role="menuitem" data-row data-flat="true" onClick={() => setView("connect")} data-connect data-keep-open>
						<Icon of={Plug} size={13} class="flex-none text-muted" />
						<span class="row-label flex-1">Connect a server…</span>
					</button>
					<button type="button" role="menuitem" data-row data-flat="true" onClick={() => picker?.click()} data-open-bundle data-keep-open>
						<Icon of={FileUp} size={13} class="flex-none text-muted" />
						<span class="row-label flex-1">Open a canvas file…</span>
					</button>
					<Show when={can("share") && stage()}>
						{(one) => (
							<a role="menuitem" data-row data-flat="true" href={api(`/bundle/${encodeURIComponent(one().name)}`)} download="" data-download-bundle>
								<Icon of={Download} size={13} class="flex-none text-muted" />
								<span class="row-label flex-1 truncate">Download this canvas</span>
								<span class="meta flex-none text-micro">.decks</span>
							</a>
						)}
					</Show>
					<Show when={error()}>{(text) => <p class="switcher-error">{text()}</p>}</Show>
				</Show>
			</Popover>
		</>
	);
}
