import type {
	AgentKind,
	AgentChat,
	AgentModel,
	AgentUsage,
	Board,
	Camera,
	ChatItem,
	DeckState,
	ExtensionUiPrompt,
	Identity,
	ModelOption,
	ThinkingLevel,
} from "@decks/protocol";
import Minus from "lucide-solid/icons/minus";
import Moon from "lucide-solid/icons/moon";
import Plus from "lucide-solid/icons/plus";
import Sun from "lucide-solid/icons/sun";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { BoardRail } from "./canvas/BoardRail.tsx";
import type { EditorHost, Tool } from "./canvas/Editor.ts";
import { FilePicker } from "./canvas/FilePicker.tsx";
import { DecksMark, Icon } from "./icons.tsx";
import { Palette } from "./canvas/Palette.tsx";
import { Stage } from "./canvas/Stage.tsx";
import { runStageCall } from "./canvas/stage-ops.ts";
import { Bubbles } from "./chat/Bubbles.tsx";
import { ChatList } from "./chat/ChatList.tsx";
import { Dialog } from "./chat/Dialog.tsx";
import { Latest } from "./chat/Latest.tsx";
import { Composer } from "./chat/Composer.tsx";
import { TurnBar, turnsOf } from "./chat/TurnBar.tsx";
import { boxOf, fit, INTERACT_ZOOM } from "./lib/camera.ts";
import { connect, type Socket } from "./lib/socket.ts";
import { createPanels } from "./lib/panels.ts";
import { scheme, toggleScheme } from "./lib/theme.ts";

interface Notice {
	id: number;
	level: "info" | "warn" | "error";
	text: string;
}

/**
 * The shell: a title bar, the stage, and the panels floating over it.
 *
 * All server state arrives on the socket and nothing is fetched twice — the
 * greeting after a connect is the whole deck, so a reconnect is a refresh. The
 * camera is the one piece of state that is the browser's alone; it is not sent
 * anywhere until an agent asks about it (M3).
 */
export function App() {
	const [state, setState] = createStore<{
		deck?: DeckState;
		boards: Board[];
		notices: Notice[];
		/** One entry per agent, so switching chats (M5) is a lookup and not a fetch. */
		chats: AgentChat[];
		focused?: string;
		identities: Record<string, Identity>;
		transcripts: Record<string, ChatItem[]>;
		models: ModelOption[];
		model?: AgentModel;
		usage?: AgentUsage;
		dialog?: ExtensionUiPrompt;
		/** Boards each agent is holding, from `context.changed`. */
		contexts: Record<string, string[]>;
		/** The subset each agent has put on the canvas. */
		inPlay: Record<string, string[]>;
		/** Reload counters from `stage.reload`, per board. */
		nonces: Record<string, number>;
		defaultKind: AgentKind;
		cursor?: { path: string; x: number; y: number; label: string; color: string } | null;
		/**
		 * A point being previewed, and the revisions to render while it is.
		 *
		 * Preview is a *look*: the frames load revisions out of the store instead of
		 * the file, the stage refuses pointer events, and nothing is written until the
		 * user actually clicks the notch.
		 */
		preview?: { entryId: string; boards: Record<string, string> };
	}>({
		boards: [],
		notices: [],
		chats: [],
		identities: {},
		transcripts: {} as Record<string, ChatItem[]>,
		models: [],
		contexts: {} as Record<string, string[]>,
		inPlay: {} as Record<string, string[]>,
		nonces: {} as Record<string, number>,
		defaultKind: "pi" as AgentKind,
	});

	const [camera, setCamera] = createSignal<Camera>({ x: 0, y: 0, zoom: 1 });
	const [connected, setConnected] = createSignal(false);
	const [selected, setSelected] = createSignal<string | undefined>(undefined);
	const [tool, setTool] = createSignal<Tool>("select");
	const [component, setComponent] = createSignal<{ path: string; id: string } | undefined>(undefined);
	const [picking, setPicking] = createSignal<((path: string | undefined) => void) | undefined>(undefined);
	const panels = createPanels();
	/** The turn the chat was opened at, from a click on the spine. */
	const [atTurn, setAtTurn] = createSignal<{ id: string; at: number } | undefined>(undefined);
	/**
	 * When this conversation was last looked at.
	 *
	 * The spine marks turns that arrived since, which is what tells you something was
	 * said while the panel was away. While the panel is open nothing is unseen, so the
	 * comparison is skipped entirely rather than being kept up to date — see `turns`.
	 */
	const [seenAt, setSeenAt] = createSignal(Date.now());
	/**
	 * A reply the user has waved away, by id.
	 *
	 * Kept per message rather than as a flag, so dismissing this one does not also hide the
	 * next one — the point of the glimpse is that the *newest* thing is there.
	 */
	const [dismissed, setDismissed] = createSignal<string | undefined>(undefined);
	/**
	 * Unread counts, kept here rather than on the server.
	 *
	 * "Have I read this" is a fact about a person in front of a browser, not about the
	 * agent — a second tab has its own answer, and the server has no business
	 * guessing. Reset by opening the conversation, which is the only thing that means
	 * you have seen it.
	 */
	const [unread, setUnread] = createStore<Record<string, number>>({});

	/**
	 * Revisions this browser caused, by path.
	 *
	 * Its own edit is already in the frame's DOM, so reloading the frame to show it
	 * would throw away the thing it is showing and flash. Somebody else's edit — the
	 * agent's, another tab's — does reload.
	 *
	 * This is keyed by revision rather than being a "just wrote it" flag because one
	 * patch produces *two* `board.changed` messages: the immediate one from the write and
	 * the watcher's, both carrying the same rev. A flag is consumed by the first and the
	 * second then looks exactly like somebody else's write — it unpinned the frame and
	 * reloaded the document out from under the user, which is the flash you see on every
	 * component drag. A rev is a content hash, so matching on it absorbs however many
	 * echoes arrive and still reloads for a rev we did not produce.
	 */
	const selfRevs = new Map<string, number>();
	/** Paths with a patch in flight, before the accepted rev is known. */
	const patching = new Set<string>();
	/**
	 * The revision each frame is pinned to, or 0 for "show the newest".
	 *
	 * A pin is what stops a reload. Our own edit is already in the frame's DOM, so the
	 * frame is pinned to the revision it *loaded* — not the one it just produced —
	 * and the URL therefore does not change. Somebody else's edit clears the pin, the
	 * URL changes, and the frame reloads, which is exactly what should happen.
	 */
	const [frameRevs, setFrameRevs] = createStore<Record<string, number>>({});

	let socket: Socket;
	let noticeId = 0;

	const notice = (level: Notice["level"], text: string) => {
		const id = ++noticeId;
		setState("notices", (all) => [...all, { id, level, text }]);
		// Length-based, floored and capped: long enough to read, short enough that a
		// burst of warnings does not become a wall.
		const linger = Math.min(12000, Math.max(4000, (text.length / 20) * 1000));
		setTimeout(() => setState("notices", (all) => all.filter((item) => item.id !== id)), linger);
	};

	onMount(() => {
		socket = connect(setConnected);
		const off = socket.on((message) => {
			switch (message.type) {
				case "deck.state":
					setState("deck", message.deck);
					/*
					 * Reconciled by path, not replaced.
					 *
					 * A board row owns a live iframe, and Solid re-creates a row whose item
					 * is a new object — so assigning a fresh array reloaded every board on
					 * screen. That is what "moving a board refreshes the page" was: a drag
					 * writes deck.json, the watcher reports it, and the whole deck arrived
					 * as new objects. `reconcile` keyed on the path updates the boards that
					 * changed and leaves the rest — and their documents — alone.
					 */
					setState("boards", reconcile(message.deck.boards, { key: "path", merge: false }));
					return;
				case "board.patched": {
					patching.delete(message.path);
					if (message.refused) {
						notice("warn", message.refused);
						// Its optimistic DOM is now a lie: unpin and reload from the file.
						selfRevs.delete(message.path);
						setFrameRevs(message.path, 0);
						setState("nonces", message.path, (current = 0) => current + 1);
						return;
					}
					// Accepted: remember the rev our write produced so both echoes of it are
					// recognised, and keep the pin so the frame holds the DOM it already has.
					selfRevs.set(message.path, message.rev);
					return;
				}

				case "board.changed": {
					if (message.removed) {
						setState("boards", (boards) => boards.filter((board) => board.path !== message.path));
						return;
					}
					if (!message.board) return;
					const board = message.board;
					if (selfRevs.get(board.path) === board.rev) {
						// Our own write, already on screen. Kept, not consumed: the same rev
						// arrives twice and the second copy must not read as somebody else's.
					} else if (patching.has(board.path)) {
						// The echo overtook the acknowledgement — adopt it as ours.
						selfRevs.set(board.path, board.rev);
					} else {
						// Somebody else wrote it — the agent, another tab, an editor. Drop
						// the pin so the frame loads what is now on disk.
						selfRevs.delete(board.path);
						setFrameRevs(board.path, 0);
					}
					// Merged into the existing row so its frame survives; only a board that
					// is genuinely new grows the array.
					//
					// `reconcile` with `merge` rather than a plain assignment: `Stage` renders
					// the boards with `<For>`, which keys by reference, so replacing the object
					// at this index makes the row new — and re-creating a row re-creates its
					// iframe, which reloads the document. That is a full white-flash reload of
					// the board the user is editing, on every component drag, showing the very
					// bytes the live DOM already has. Merging leaves the identity alone and
					// updates only the fields that moved.
					const index = state.boards.findIndex((existing) => existing.path === board.path);
					if (index === -1) {
						setState("boards", (boards) => [...boards, board].sort((a, b) => a.path.localeCompare(b.path)));
					} else {
						setState("boards", index, reconcile(board, { merge: true }));
					}
					return;
				}
				case "agents": {
					const focused = message.focused ?? state.focused;
					// A different conversation is a different history: the turn the chat was
					// opened at belongs to the one you were reading.
					if (focused !== state.focused) {
						setAtTurn(undefined);
						setSeenAt(Date.now());
					}
					setState({ chats: message.chats, focused, defaultKind: message.defaultKind });
					return;
				}

				case "agent.identity":
					setState("identities", message.id, message.identity);
					return;

				case "agent.state":
					setState("chats", (chats) => chats.map((chat) => (chat.id === message.id ? { ...chat, state: message.state } : chat)));
					return;

				case "agent.model":
					setState("model", message.model);
					return;

				case "agent.usage":
					setState("usage", message.usage);
					return;

				case "models":
					setState("models", message.models);
					return;

				case "chat.history":
					setState("transcripts", message.agentId, message.items);
					return;

				case "chat.item": {
					const item = message.item;
					/*
					 * A reply you cannot see is the thing an unread count is for — whether
					 * that is because you are in another conversation or because the panel
					 * is away. Your own messages are not news.
					 */
					const unseen = message.agentId !== state.focused || !panels.right.open();
					if (unseen && item.kind === "assistant") setUnread(message.agentId, (count = 0) => count + 1);
					setState("transcripts", message.agentId, (items = []) => {
						const index = items.findIndex((existing) => existing.id === item.id);
						if (index === -1) return [...items, item];
						const next = [...items];
						next[index] = item;
						return next;
					});
					return;
				}

				case "chat.delta": {
					// Deltas are applied to the item in place: the server sends the whole
					// item at the start and the end, and the increments in between.
					setState("transcripts", message.agentId, (items = []) =>
						items.map((item) => {
							if (item.id !== message.itemId || item.kind !== "assistant") return item;
							return message.field === "thinking"
								? { ...item, thinking: (item.thinking ?? "") + message.delta }
								: { ...item, text: item.text + message.delta };
						}),
					);
					return;
				}

				case "timeline.preview":
					setState("preview", message.entryId ? { entryId: message.entryId, boards: message.boards } : undefined);
					return;

				case "context.changed":
					setState("contexts", message.agentId, message.boards);
					setState("inPlay", message.agentId, message.inPlay);
					return;

				case "stage.call": {
					/*
					 * An agent asking something of the canvas. It is answered, always —
					 * the server is holding a tool call open on it, and a refusal it can
					 * read beats a timeout it cannot.
					 */
					let value: unknown;
					try {
						value = runStageCall(message.call, {
							boards: () => state.boards,
							viewport: () => {
								const stage = document.querySelector(".stage");
								return { width: stage?.clientWidth ?? 0, height: stage?.clientHeight ?? 0 };
							},
							setCamera: (camera) => setCamera(camera),
							select: (path) => setSelected(path),
							reload: (path) => setState("nonces", path, (current = 0) => current + 1),
							cursor: (cursor) => setState("cursor", cursor),
							toast: (text) => notice("info", text),
						});
					} catch (error) {
						value = { error: error instanceof Error ? error.message : String(error) };
					}
					socket.send({ type: "stage.result", result: { id: message.call.id, value } });
					return;
				}

				case "extension.ui.prompt":
					setState("dialog", message.prompt);
					// Drawn in the dock, above the input bar, so it needs nothing dragged
					// open to be seen.
					return;

				case "extension.ui.prompt.closed":
					setState("dialog", (current) => (current?.id === message.id ? undefined : current));
					return;

				case "notice":
					notice(message.level, message.text);
					return;
				case "error":
					notice("error", message.text);
					return;
				default:
					return;
			}
		});
		onCleanup(off);
	});

	const move = (path: string, x: number, y: number) => {
		// Optimistic, and in place: the board is already where it was dropped, and the
		// server's answer confirms it. Replacing the object here would re-create the
		// row and reload the document that is sitting in it.
		const index = state.boards.findIndex((board) => board.path === path);
		if (index >= 0) setState("boards", index, { x, y });
		socket.send({ type: "board.move", path, x, y });
	};

	const focusedChat = createMemo(() => state.chats.find((chat) => chat.id === state.focused));
	const transcript = createMemo(() => (state.focused ? state.transcripts[state.focused] ?? [] : []));
	const busy = createMemo(() => {
		const chat = focusedChat();
		return chat ? chat.state !== "idle" : false;
	});

	/**
	 * Tell the server where the user is looking, but not on every frame.
	 *
	 * A pan is hundreds of camera changes and the server only needs the resting
	 * place, so this trails the gesture by a beat rather than narrating it.
	 */
	let cameraTimer: number | undefined;
	const reportCamera = (camera: Camera) => {
		if (cameraTimer) clearTimeout(cameraTimer);
		cameraTimer = window.setTimeout(() => socket.send({ type: "camera.set", camera }), 250);
	};

	const setCameraAndReport = (camera: Camera) => {
		setCamera(camera);
		reportCamera(camera);
	};

	/**
	 * What the focused agent holds, restricted to boards that still exist.
	 *
	 * The server prunes deleted boards out of context, but context is also rebuilt from a
	 * transcript when rewinding, and a transcript can name a board that has since been
	 * deleted. Resolving here means one dead path can never empty the rail and the canvas
	 * at once: an agent left holding only ghosts counts as holding nothing, which is the
	 * case the whole-deck fallback exists for.
	 */
	const held = createMemo(() => {
		const paths = state.focused ? state.contexts[state.focused] ?? [] : [];
		if (paths.length === 0) return paths;
		const known = new Set(state.boards.map((board) => board.path));
		return paths.filter((path) => known.has(path));
	});

	/** The focused agent's boards, in attach order — or the whole deck if it holds none. */
	const railBoards = createMemo(() => {
		if (held().length === 0) return state.boards;
		const byPath = new Map(state.boards.map((board) => [board.path, board]));
		return held().flatMap((path) => {
			const board = byPath.get(path);
			return board ? [board] : [];
		});
	});

	/**
	 * What is on the canvas: the focused agent's in-play set.
	 *
	 * An agent holding nothing shows the whole deck — without that, a fresh agent on a
	 * deck full of work would open onto a blank canvas, which reads as data loss rather
	 * than as an empty context.
	 */
	const stageBoards = createMemo(() => {
		if (held().length === 0) return state.boards;
		const playing = new Set(state.focused ? state.inPlay[state.focused] ?? [] : []);
		return state.boards.filter((board) => playing.has(board.path));
	});

	/**
	 * Who to tell when the selection moves.
	 *
	 * Each board frame draws its own selection overlay, so all of them need to hear:
	 * the one that gained the selection to draw it, and the one that lost it to stop.
	 */
	const selectionListeners = new Set<() => void>();
	createEffect(() => {
		component();
		for (const listener of selectionListeners) listener();
	});

	const editor: EditorHost = {
		tool: () => tool(),
		resetTool: () => setTool("select"),
		selected: () => component(),
		select: (selection) => {
			setComponent(selection);
			if (selection) setSelected(selection.path);
		},
		onSelectionChange: (listener) => {
			selectionListeners.add(listener);
			return () => selectionListeners.delete(listener);
		},
		patch: (path, patches) => {
			const board = state.boards.find((candidate) => candidate.path === path);
			if (!board) return;
			patching.add(path);
			// Pin to what the frame is showing *now*, before the write lands — and only if
			// it is not already pinned. Re-pinning on each edit moves the pin to the newest
			// rev while the document on screen is still the one it first loaded, so the URL
			// changes and the frame reloads: the flash came back on the second drag.
			if (!frameRevs[path]) setFrameRevs(path, board.rev);
			socket.send({ type: "board.patch", path, rev: board.rev, patches });
		},
		undo: (path) => socket.send({ type: "board.undo", path }),
		pickFile: () =>
			new Promise<string | undefined>((resolve) => {
				setPicking(() => (picked: string | undefined) => {
					setPicking(undefined);
					resolve(picked);
				});
			}),
		notice: (text) => notice("info", text),
		// Editing follows the same threshold as pointer events: if the frame is inert
		// because we are zoomed out, there is nothing to edit with.
		enabled: () => camera().zoom >= INTERACT_ZOOM,
	};

	const turns = createMemo(() => turnsOf(transcript(), panels.right.open() ? Number.POSITIVE_INFINITY : seenAt()));

	createEffect(() => {
		if (!panels.right.open()) setSeenAt(Date.now());
	});

	const flyTo = (board: Board) => {
		setSelected(board.path);
		const stage = document.querySelector(".stage");
		if (!stage) return;
		setCamera(fit([boxOf(board)], { width: stage.clientWidth, height: stage.clientHeight }));
	};

	return (
		<div class="app">
			<header class="titlebar">
				{/* The connection state used to be its own dot beside the deck name. With the
				    name and the path gone the dot would be the only thing left to explain,
				    so it lives in the mark's colour instead — nothing is lost, and there is
				    one thing on the left rather than three. */}
				<span
					class="brand"
					data-off={!connected()}
					title={connected() ? "Decks" : "Decks — not connected to the server"}
				>
					<DecksMark />
					<span class="wordmark">Decks</span>
				</span>
				<span class="spacer" />
				<button
					class="icon-button"
					type="button"
					onClick={() => toggleScheme()}
					title={scheme() === "dark" ? "Switch to light" : "Switch to dark"}
					aria-label={scheme() === "dark" ? "Switch to light" : "Switch to dark"}
				>
					{/* The icon is the destination, not the current state: it is a button, and
					    what a button shows should be what pressing it gets you. */}
					{scheme() === "dark" ? <Icon of={Sun} size={17} /> : <Icon of={Moon} size={17} />}
				</button>
			</header>

			<div class="work">
				<Stage
					boards={stageBoards()}
					camera={camera()}
					setCamera={setCameraAndReport}
					selected={selected()}
					onSelect={setSelected}
					onMove={move}
					onHide={(path) => socket.send({ type: "board.hide", path })}
					nonces={state.nonces}
					cursor={state.cursor}
					onViewport={() => reportCamera(camera())}
					editor={editor}
					frameRevs={frameRevs}
					preview={state.preview?.boards}
				/>

				<Palette tool={tool()} visible={camera().zoom >= INTERACT_ZOOM} onPick={setTool} />

				<Show when={picking()}>
					{(resolve) => (
						<FilePicker onPick={(path) => resolve()(path)} onCancel={() => resolve()(undefined)} />
					)}
				</Show>

				<aside class="panel-float side" data-open={panels.left.open()}>
					<ChatList
						chats={state.chats}
						identities={state.identities}
						focused={state.focused}
						unread={unread}
						onFocus={(id) => {
							setState("focused", id);
							setUnread(id, 0);
							setAtTurn(undefined);
							setSeenAt(Date.now());
							socket.send({ type: "agent.focus", id });
						}}
						defaultKind={state.defaultKind}
						onNew={(kind) => socket.send({ type: "agent.create", ...(kind ? { kind } : {}) })}
						pinned={panels.left.pinned()}
						onPin={panels.left.setPinned}
					/>

					<BoardRail
						boards={railBoards()}
						current={selected()}
						held={held().length > 0}
						inPlay={state.focused ? state.inPlay[state.focused] ?? [] : []}
						onPick={(board) => {
							// A click on the rail is how the user puts a board on the canvas. It
							// moves the camera because they asked for it — the rule that nothing
							// moves on its own is about the agent, not about your own clicks.
							socket.send({ type: "board.play", path: board.path });
							flyTo(board);
						}}
					/>
				</aside>

				<Bubbles
					agent={focusedChat()}
					identity={state.focused ? state.identities[state.focused] : undefined}
					items={transcript()}
					previewing={Boolean(state.preview)}
					open={panels.right.open()}
					pinned={panels.right.pinned()}
					unread={Boolean(state.focused && unread[state.focused])}
					onPin={panels.right.setPinned}
					scrollTo={atTurn()}
					onPreview={(entryId) => {
						if (!state.focused) return;
						if (!entryId) {
							setState("preview", undefined);
							return;
						}
						socket.send({ type: "rewind.preview", id: state.focused, entryId });
					}}
					onRewind={(entryId) => {
						if (!state.focused) return;
						setState("preview", undefined);
						socket.send({ type: "rewind.to", id: state.focused, entryId });
					}}
					onFork={(entryId) => {
						if (!state.focused) return;
						setState("preview", undefined);
						socket.send({ type: "fork.from", id: state.focused, entryId });
					}}
					onRestore={(entryId) => {
						if (!state.focused) return;
						setState("preview", undefined);
						socket.send({ type: "boards.restore", id: state.focused, entryId });
					}}
				/>

				{/*
				 * The dock: what the agent last said, a question if one is waiting, and the
				 * input bar. One bottom-centred stack, because these three are the same
				 * conversation and they should not be in three different places.
				 */}
				<div class="dock">
					{/* First in the dock, so it sits above whatever else is in it rather than
					    at a hardcoded offset that a taller stack would collide with. */}
					<Show when={state.boards.length > 0}>
						<div class="hint">two-finger scroll to pan · pinch or ⌘-wheel to zoom · space-drag anywhere · 0 fit all · 1 fit board</div>
					</Show>

					<Show when={state.dialog}>
						{(prompt) => (
							<Dialog
								prompt={prompt()}
								onAnswer={(answer) => {
									socket.send({
										type: "extension.ui.answer",
										answer: { id: prompt().id, ...answer } as never,
									});
									setState("dialog", undefined);
								}}
							/>
						)}
					</Show>

					<Latest
						items={transcript()}
						columnOpen={panels.right.open()}
						onOpen={() => {
							panels.right.hold(true);
							setSeenAt(Date.now());
						}}
						dismissed={dismissed()}
						onDismiss={(id) => setDismissed(id)}
					/>

					<Composer
					busy={busy()}
					model={state.model}
					models={state.models}
					usage={state.usage}
					modes={focusedChat()?.capabilities?.modes ?? []}
					mode={focusedChat()?.mode}
					onMode={(mode) => socket.send({ type: "agent.setMode", id: state.focused ?? "", mode })}
					onSend={(text) => socket.send({ type: "agent.prompt", id: state.focused ?? "", text })}
					onAbort={() => socket.send({ type: "agent.abort", id: state.focused ?? "" })}
					onModel={(provider, model) =>
						socket.send({ type: "agent.setModel", id: state.focused ?? "", provider, model })
					}
						onThinking={(thinking: ThinkingLevel) =>
							socket.send({ type: "agent.thinking", id: state.focused ?? "", thinking })
						}
					/>
				</div>

				<div class="panel-float zoombar">
					<button type="button" title="Fit all (0)" onClick={() => fitAll(state.boards, setCamera)}>
						fit
					</button>
					<span class="level">{Math.round(camera().zoom * 100)}%</span>
					{/* Titled, now that the glyph is gone: an icon-only button with no accessible
					    name is a button screen readers and the browser checks both read as blank. */}
					<button
						class="icon-button"
						type="button"
						title="Zoom in (=)"
						aria-label="Zoom in"
						onClick={() => setCamera((c) => ({ ...c, zoom: Math.min(4, c.zoom * 1.25) }))}
					>
						<Icon of={Plus} />
					</button>
					<button
						class="icon-button"
						type="button"
						title="Zoom out (-)"
						aria-label="Zoom out"
						onClick={() => setCamera((c) => ({ ...c, zoom: Math.max(0.02, c.zoom / 1.25) }))}
					>
						<Icon of={Minus} />
					</button>
				</div>

				<TurnBar
					turns={turns()}
					at={atTurn()?.id}
					onPick={(turn) => {
						setAtTurn({ id: turn.id, at: Date.now() });
						// Held rather than pinned: it stays while you read and leaves when you
						// move away, without becoming another piece of state to turn off.
						panels.right.hold(true);
					}}
				/>

				<div class="notices">
					<For each={state.notices}>{(item) => <div class="notice" data-level={item.level}>{item.text}</div>}</For>
				</div>

			</div>
		</div>
	);
}

function fitAll(boards: Board[], setCamera: (camera: Camera) => void): void {
	const stage = document.querySelector(".stage");
	if (!stage) return;
	setCamera(fit(boards.map(boxOf), { width: stage.clientWidth, height: stage.clientHeight }));
}
