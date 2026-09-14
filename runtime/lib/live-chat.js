/**
 * A live board: a window onto a conversation, drawn inside a board's own document.
 *
 * A mirror board's file is four lines and never changes — one component carrying
 * `data-live="chat"` and an agent id. Everything here happens in the browser, fed by the
 * app through `postMessage`, because the app is already holding every agent's transcript
 * and a mirror is a second view of it rather than a second copy.
 *
 * Two rules decide how it behaves, and between them they are the whole feel of the thing:
 *
 * **It scrolls, and it hands the scroll back.** The list is `overflow-y: auto` and nothing
 * else is needed: `frame-gestures.ts` already walks up from the pointer, finds the nearest
 * box that can still take a wheel, gives it the delta divided by the camera's scale, and
 * lets the canvas have it at the ends. So a flick past the last turn keeps going and pans
 * — a mirror cannot trap you — and a finger does the same thing, decided once at the start
 * of the drag.
 *
 * **It is pinned to now until you scroll away from it.** At the bottom, a new turn follows;
 * the moment the list is not at the bottom it lets go, so nothing yanks the text out from
 * under a reader mid-sentence. What arrives while it is let go is counted on a chip, and
 * both ways back — pressing the chip and scrolling to the end — mean the same thing.
 *
 * Below `INTERACT_ZOOM` a board takes no pointer events at all, so a mirror that is zoomed
 * out cannot be scrolled and simply shows the newest turn. That is not a limitation to
 * work around: it is what makes three mirrors side by side a glance and one mirror
 * zoomed-in a transcript, with no mode for anybody to set.
 *
 * **What it draws is the conversation column's anatomy — one decision, made in
 * `apps/web/src/chat/` and repeated here in a board's own script.** A mirror is not a
 * second renderer with opinions of its own: it is the same transcript looked at from a
 * board, and a reader who has both open should not be able to tell which one taught them
 * the shapes. So, from `chat/float-rows.ts` and `chat/tool-groups.ts`:
 *
 * - A run of consecutive tool calls in one turn is **one row**, not one row per call, and
 *   inside it the calls that finished cleanly hide behind a count while a running or failed
 *   one keeps a line of its own. `toolSlots` below is that rule, verbatim.
 * - An assistant turn with nothing in it yet is **no row at all**. A step that opens with a
 *   tool call would otherwise draw an empty box for as long as the tool takes.
 * - Thinking is a disclosure, collapsed, above the reply it belongs to.
 * - A tool call is a *line in a log*: a status glyph, the tool's name in mono, its subject,
 *   and the output behind the row rather than in it.
 *
 * And from `chat/Turn.tsx`, the one place the two surfaces deliberately differ: **the agent's
 * words are not in a box.** In the floating column there is nothing behind a reply, so flat
 * prose would be text lying directly on top of a board and the card is what makes it legible.
 * Here the panel *is* the box — the page's own `--b-bg` — so the box would be a box inside a
 * box, which is exactly the "pill in a pill" this app has already thrown away once. Yours keep
 * their bubble: the asymmetry moves from *box or no box* to **width and tint**, which is where
 * the column landed too.
 *
 * The open/closed state of every disclosure is kept in `openRows` and restored as rows are
 * redrawn, because a streaming reply redraws its own row on every frame — and a thinking
 * block that shut itself the moment the agent said another word is worse than no disclosure
 * at all. `picone/ChatTab.tsx` has the same note about the same bug.
 */

const PIN_SLACK = 8;
const RETRY_MS = 250;
const RETRY_FOR_MS = 8000;

/** How many distinct tool names a group's header shows before it starts counting them (`tool-groups.ts`). */
const NAMES = 3;

/** The svg shell every glyph here is drawn in — the app's icons are lucide, and so are these paths. */
function glyph(paths) {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	for (const d of paths) {
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", d);
		svg.append(path);
	}
	return svg;
}

/** The chevron at a row's right end: turned, never swapped, which is this app's convention. */
function chevron() {
	const svg = glyph(["m9 6 6 6-6 6"]);
	svg.setAttribute("class", "twist");
	return svg;
}

/** Failure gets a shape rather than a colour, so it survives a reader who cannot tell red from grey. */
function triangle() {
	return glyph(["m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3", "M12 9v4", "M12 17h.01"]);
}

/**
 * The transcript, condensed the way the column condenses it (`chat/float-rows.ts`).
 *
 * `index` is the **last** item the row covers, which is the only thing `render` needs: a
 * feed that starts at item *n* has to rebuild the row that contains item *n* and everything
 * after it — including a tool row that item *n* has just been added to.
 */
function rowsOf(items) {
	const rows = [];
	let turn = items[0]?.id ?? "";
	for (let index = 0; index < items.length; index++) {
		const item = items[index];
		if (item.kind === "user") turn = item.id;
		if (item.kind === "assistant") {
			if (!(item.text ?? "").trim() && !(item.thinking ?? "").trim()) continue;
			rows.push({ kind: "assistant", item, index });
			continue;
		}
		if (item.kind === "notice") {
			rows.push({ kind: "notice", item, index });
			continue;
		}
		if (item.kind === "user") {
			rows.push({ kind: "user", item, index });
			continue;
		}
		if (item.kind !== "tool") {
			// A kind this build has never heard of still gets a row: dropping it would leave
			// the transcript quietly out of step with what the agent actually did.
			rows.push({ kind: "other", item, index });
			continue;
		}
		const last = rows.at(-1);
		if (last && last.kind === "tools" && last.turn === turn) {
			last.calls.push(item);
			last.index = index;
			continue;
		}
		rows.push({ kind: "tools", item, index, turn, calls: [item] });
	}
	return rows;
}

/** A call that finished and finished cleanly — the only kind that may hide behind a count. */
const collapsible = (call) => call.state === "done";

/**
 * Which of a turn's tool calls may hide behind a count, and which may not (`tool-groups.ts`).
 *
 * Three ways of *not* grouping, and each one earns its place: the running call never
 * collapses (a progress indicator that stops indicating is not one), a failed call never
 * collapses (it is the one line in the turn worth the space), and a run of one is just a row
 * (a header over a single thing costs 24px and a click to say "1").
 */
function toolSlots(calls) {
	const slots = [];
	let run = [];

	const flush = () => {
		if (run.length === 1) slots.push({ kind: "call", id: run[0].id, call: run[0] });
		else if (run.length > 1) slots.push({ kind: "group", id: run[0].id, calls: run });
		run = [];
	};

	for (const call of calls) {
		if (collapsible(call)) {
			run.push(call);
			continue;
		}
		flush();
		slots.push({ kind: "call", id: call.id, call });
	}
	flush();
	return slots;
}

/** The names in a header: distinct, in the order they first ran, truncated (`tool-groups.ts`). */
function namesOf(calls) {
	const seen = [];
	for (const call of calls) {
		const name = (call.name ?? "").trim();
		if (!name || seen.includes(name)) continue;
		seen.push(name);
	}
	return { names: seen.slice(0, NAMES), more: Math.max(0, seen.length - NAMES) };
}

/**
 * Mount one live component.
 *
 * `api` is board.js's own toolkit, passed in rather than imported: the markdown renderer
 * has already loaded `marked` for `[data-md]` components, and a mirror that pulled in a
 * second copy of it would be a second copy for no reason.
 */
export function mountLiveChat(host, api) {
	const agent = host.dataset.agent ?? "";
	if (!agent) {
		host.textContent = "This mirror has no agent to mirror.";
		host.dataset.state = "empty";
		return;
	}

	host.textContent = "";
	const head = document.createElement("div");
	head.className = "live-head";
	const dot = document.createElement("span");
	dot.className = "live-dot";
	const name = document.createElement("span");
	name.className = "live-name";
	name.textContent = "…";
	head.append(dot, name);

	const list = document.createElement("div");
	list.className = "live-list";
	// The one line that makes the canvas's scroll chaining apply to this box.
	list.style.overflowY = "auto";

	const chip = document.createElement("button");
	chip.className = "live-new";
	chip.type = "button";
	chip.hidden = true;

	host.append(head, list, chip);

	/** What this board holds, kept so `from` in the next feed means something. */
	let items = [];
	let pinned = true;
	let unseen = 0;
	let answered = false;
	/** Which disclosures the reader has opened, by row id — see the note at the top of the file. */
	const openRows = new Set();

	/** One button row, in the shape every row here shares. */
	function rowElement(tag = "button") {
		const row = document.createElement(tag);
		row.className = "live-row";
		if (tag === "button") row.type = "button";
		return row;
	}

	function stateCell(state) {
		const cell = document.createElement("span");
		cell.className = "state";
		if (state === "error") cell.append(triangle());
		return cell;
	}

	/**
	 * A tool call: one line, and its output behind it.
	 *
	 * The four parts are the column's (`chat/ToolChip.tsx`), in the same order and with the
	 * same reasons: the state cell fixed at 12px so a column of rows has one left edge, the
	 * name in mono and uppercase because it is an identifier, the subject widest because it
	 * says *which* call, and the chevron at the right end where a disclosure belongs.
	 */
	function callRow(call) {
		const output = (call.result ?? "").trimEnd();
		const open = openRows.has(`tool:${call.id}`);
		const wrap = document.createElement("div");
		wrap.className = "live-tool";
		wrap.dataset.state = call.state ?? "";
		wrap.dataset.item = call.id;

		const row = rowElement(output ? "button" : "div");
		row.dataset.open = String(open);
		if (output) {
			row.title = open ? "Hide the output" : "Show the output";
			row.setAttribute("aria-expanded", String(open));
			row.addEventListener("click", () => {
				if (openRows.has(`tool:${call.id}`)) openRows.delete(`tool:${call.id}`);
				else openRows.add(`tool:${call.id}`);
				wrap.replaceWith(callRow(call));
			});
		}
		row.append(stateCell(call.state));
		const callName = document.createElement("span");
		callName.className = "name";
		callName.textContent = call.name ?? "";
		const title = document.createElement("span");
		title.className = "title";
		title.textContent = call.title ?? "";
		row.append(callName, title);
		if (call.images) {
			const images = document.createElement("span");
			images.className = "imgs";
			images.textContent = `${call.images} img`;
			row.append(images);
		}
		if (output) row.append(chevron());
		wrap.append(row);

		if (open && output) {
			const pre = document.createElement("pre");
			pre.textContent = output;
			wrap.append(pre);
		}
		return wrap;
	}

	/** The header over the calls that went as expected — and it is one of those rows itself. */
	function groupRow(slot, alone) {
		const calls = slot.calls;
		const open = openRows.has(`group:${slot.id}`);
		const summary = namesOf(calls);
		const names = summary.more > 0 ? `${summary.names.join(" · ")} +${summary.more}` : summary.names.join(" · ");
		const word = alone ? (calls.length === 1 ? "tool" : "tools") : "done";

		const wrap = document.createElement("div");
		wrap.className = "live-tool";
		wrap.dataset.group = "";
		wrap.dataset.state = "done";

		const row = rowElement();
		row.dataset.open = String(open);
		row.title = open ? "Hide these calls" : "Show these calls";
		row.setAttribute("aria-expanded", String(open));
		row.setAttribute("aria-label", `${calls.length} finished tool calls: ${summary.names.join(", ")}`);
		row.addEventListener("click", () => {
			if (openRows.has(`group:${slot.id}`)) openRows.delete(`group:${slot.id}`);
			else openRows.add(`group:${slot.id}`);
			wrap.replaceWith(groupRow(slot, alone));
		});
		const count = document.createElement("span");
		count.className = "name";
		count.textContent = `${calls.length} ${word}`;
		const which = document.createElement("span");
		which.className = "title";
		which.textContent = names;
		row.append(stateCell("done"), count, which, chevron());
		wrap.append(row);

		if (open) {
			const kids = document.createElement("div");
			kids.className = "live-kids";
			for (const call of calls) kids.append(callRow(call));
			wrap.append(kids);
		}
		return wrap;
	}

	/**
	 * What the agent said: its thinking behind a disclosure, then the reply.
	 *
	 * Flat — no box — because the panel this board draws is the box. The sizes are the
	 * column's rather than the board's: a transcript is not a document, and an `<h2>` at a
	 * board's 22px inside a 560px window would make a one-line heading the largest thing in
	 * the conversation.
	 */
	function sayRow(item) {
		const el = document.createElement("div");
		el.className = "live-turn live-say";
		el.dataset.item = item.id;
		el.dataset.streaming = item.streaming ? "true" : "false";
		const thinking = (item.thinking ?? "").trim();
		if (thinking) {
			const open = openRows.has(`think:${item.id}`);
			const think = document.createElement("div");
			think.className = "live-think";
			const button = document.createElement("button");
			button.type = "button";
			button.textContent = open ? "hide thinking" : "thinking…";
			button.setAttribute("aria-expanded", String(open));
			button.addEventListener("click", () => {
				if (openRows.has(`think:${item.id}`)) openRows.delete(`think:${item.id}`);
				else openRows.add(`think:${item.id}`);
				el.replaceWith(sayRow(item));
			});
			think.append(button);
			if (open) {
				const body = document.createElement("div");
				body.className = "body";
				body.textContent = thinking;
				think.append(body);
			}
			el.append(think);
		}
		const body = document.createElement("div");
		body.className = "live-body";
		body.textContent = item.text ?? "";
		el.append(body);
		if ((item.text ?? "").trim()) void api.markdown(body, item.text);
		return el;
	}

	function draw(row) {
		if (row.kind === "user") {
			const el = document.createElement("div");
			el.className = "live-turn live-mine";
			el.dataset.item = row.item.id;
			const bubble = document.createElement("div");
			bubble.className = "live-bubble";
			// Verbatim, where the agent's side is markdown: it is the text that was sent.
			bubble.textContent = row.item.text;
			el.append(bubble);
			return el;
		}
		if (row.kind === "assistant") return sayRow(row.item);
		if (row.kind === "notice") {
			const el = document.createElement("div");
			el.className = "live-turn live-notice";
			el.dataset.item = row.item.id;
			el.dataset.level = row.item.level;
			el.textContent = row.item.text;
			return el;
		}
		if (row.kind === "tools") {
			const el = document.createElement("div");
			el.className = "live-turn live-tools";
			el.dataset.item = row.item.id;
			const slots = toolSlots(row.calls);
			for (const slot of slots) {
				el.append(slot.kind === "group" ? groupRow(slot, slots.length === 1) : callRow(slot.call));
			}
			return el;
		}
		const el = document.createElement("div");
		el.className = "live-turn live-other";
		el.textContent = row.item.text ?? "";
		return el;
	}

	/**
	 * The row that says the agent is still going, at the foot of the column.
	 *
	 * The column draws this as a card with the working sign in it and the words "running tools…"
	 * or "working…", taken from the state the server holds (`chat/working-sign.ts`). A mirror has
	 * no sign to draw — the marks are the app's own svg — so it is a quiet line with a dot, in the
	 * same two phrases. Read off the *items* rather than asking for a state, because a call still
	 * running or a reply still arriving is the same fact said twice.
	 *
	 * **A running call is looked for anywhere in the transcript, not only at its end.** The cheap
	 * version — ask what the last item is — was wrong in exactly the case that matters: a reply is
	 * recorded when it is spoken and a call inside it when it starts, so an assistant message sits
	 * after a running call for the second before that call finishes. That is a turn in progress,
	 * and the column says "running tools…" about it.
	 */
	function workingElement() {
		const last = items.at(-1);
		const word = items.some((item) => item.kind === "tool" && item.state === "running")
			? "running tools…"
			: last?.kind === "assistant" && last.streaming
				? "working…"
				: "";
		if (!word) return undefined;
		const el = document.createElement("div");
		el.className = "live-working";
		el.textContent = word;
		return el;
	}

	/**
	 * Redraw from `from` onwards.
	 *
	 * Rows are recomputed from the items every time — cheap, and the only way a tool row that
	 * just gained a call can be right — and the DOM is rebuilt from the one row that contains
	 * item `from`. Everything before it is untouched by construction, so a conversation of two
	 * thousand turns repaints one node when a turn arrives and one node per frame of it
	 * streaming.
	 */
	function render(from) {
		const rows = rowsOf(items);
		const found = rows.findIndex((row) => row.index >= from);
		const start = found === -1 ? rows.length : found;
		// The working row is not a row of the transcript and is rebuilt from the whole of it.
		list.querySelector(".live-working")?.remove();
		for (let index = list.children.length - 1; index >= start; index--) list.children[index].remove();
		for (let index = start; index < rows.length; index++) list.append(draw(rows[index]));
		const working = workingElement();
		if (working) list.append(working);
	}

	const atBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight <= PIN_SLACK;

	function toBottom() {
		list.scrollTop = list.scrollHeight;
		pinned = true;
		unseen = 0;
		chip.hidden = true;
	}

	list.addEventListener("scroll", () => {
		if (atBottom()) {
			// Reaching the end is the same gesture as pressing the chip, deliberately: a
			// reader who scrolls back down has said they want to follow again.
			pinned = true;
			unseen = 0;
			chip.hidden = true;
		} else {
			pinned = false;
		}
	});
	chip.addEventListener("click", toBottom);

	function receive(feed) {
		const before = items.length;
		/*
		 * A `from` past the end of what this board holds is not an append: it would leave rows on
		 * screen that nothing describes, because `render` rebuilds from the row that *contains*
		 * `from` and there is no such row. The app never sends one — `liveDelta` answers with how
		 * many items the two ends share — so this is about a malformed feed being a reset rather
		 * than a stale list.
		 */
		const from = feed.from > items.length ? 0 : feed.from;
		items = [...items.slice(0, from), ...feed.items];
		if (feed.identity) {
			name.textContent = feed.identity.name;
			if (feed.identity.color) host.style.setProperty("--live-accent", feed.identity.color);
		}
		render(from);

		if (!answered) {
			answered = true;
			host.dataset.state = "live";
			toBottom();
			return;
		}
		if (pinned) {
			toBottom();
			return;
		}
		// Only genuinely new turns count as missed; a turn growing while you read further
		// up is not something you have not seen.
		const added = items.length - before;
		if (added > 0) {
			unseen += added;
			chip.textContent = `↓ ${unseen} new`;
			chip.hidden = false;
		}
	}

	window.addEventListener("message", (event) => {
		// Only from the app that is showing this board; an embed inside it is not the app.
		if (event.source !== window.parent) return;
		const feed = event.data;
		if (!feed || feed.decks !== "live.chat" || feed.agent !== agent) return;
		if (typeof feed.from !== "number" || !Array.isArray(feed.items)) return;
		receive(feed);
	});

	/*
	 * Ask, and keep asking until answered.
	 *
	 * A handshake would need the app to speak first, and the app attaches its listener when
	 * the frame loads — which is a race this board would sometimes lose and then sit empty
	 * forever. Repeating the question costs one message every quarter second for at most
	 * eight, and a mirror in a deck opened outside the app simply says so.
	 */
	const want = { decks: "live.want", kind: "chat", agent };
	const ask = () => window.parent?.postMessage(want, "*");
	ask();
	const started = Date.now();
	const timer = setInterval(() => {
		if (answered || Date.now() - started > RETRY_FOR_MS) {
			clearInterval(timer);
			if (!answered) host.dataset.state = "alone";
			return;
		}
		ask();
	}, RETRY_MS);
}
