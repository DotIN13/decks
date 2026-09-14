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
 * **What it draws is the conversation column's anatomy — and the shape of a transcript is
 * decided in `apps/web/src/chat/`, not here.** The app posts *cards*: a reply and the calls it
 * made are one card, a run of finished calls is one row inside it, a call's output is behind
 * that row. So this file has no `floatRows`, no `toolSlots` and no `distinctNames`, and that is the
 * point rather than an accident of packaging.
 *
 * It used to have all three, copied from `chat/float-rows.ts` and `chat/tool-groups.ts` with a
 * note about keeping them in step — and they did not stay in step. The column drops a finished
 * turn whose only content is thinking; the copy here kept it, so the same conversation had a
 * row in a mirror that was nowhere in the column, and the two surfaces quietly disagreed about
 * what was said. A duplicated rule is not fixed by a better comment about duplication. The fold
 * runs once, in the module both ends are handed, and a board draws what it is given.
 *
 * What is genuinely a mirror's own is the drawing. From `chat/Turn.tsx`, the one place the two
 * surfaces deliberately differ: **the agent's words are not in a box.** In the floating column
 * there is nothing behind a reply, so flat prose would be text lying directly on top of a board
 * and the card is what makes it legible. Here the panel *is* the box — the page's own `--b-bg`
 * — so the box would be a box inside a box, which is exactly the "pill in a pill" this app has
 * already thrown away once. Yours keep their bubble: the asymmetry moves from *box or no box*
 * to **width and tint**, which is where the column landed too. A card is therefore a turn's
 * *grouping* — its parts 8px apart, 10px between turns — and not a plate.
 *
 * The open/closed state of every disclosure is kept in `openRows` and restored as rows are
 * redrawn, because a streaming reply redraws its own row on every frame — and a thinking
 * block that shut itself the moment the agent said another word is worse than no disclosure
 * at all. `picone/ChatTab.tsx` has the same note about the same bug.
 */

const PIN_SLACK = 8;
const RETRY_MS = 250;
const RETRY_FOR_MS = 8000;

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
	let turns = [];
	/** What the agent is doing, in the app's own words — or nothing when it is doing nothing. */
	let working = "";
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

	/**
	 * The header over the calls that went as expected — and it is one of those rows itself.
	 *
	 * The names in it arrive with the slot. They are the answer to *which calls are behind this
	 * count*, which is data rather than wording, and the column's header says the same thing
	 * because `chat/tool-groups.ts` worked it out once for both (`distinctNames`: deduped, in the
	 * order they first ran, truncated to three with the rest as `+N`).
	 */
	function groupRow(slot, alone) {
		const calls = slot.calls;
		const open = openRows.has(`group:${slot.id}`);
		const names = slot.more > 0 ? `${slot.names.join(" · ")} +${slot.more}` : slot.names.join(" · ");
		const word = alone ? (calls.length === 1 ? "tool" : "tools") : "done";

		const wrap = document.createElement("div");
		wrap.className = "live-tool";
		wrap.dataset.group = "";
		wrap.dataset.state = "done";

		const row = rowElement();
		row.dataset.open = String(open);
		row.title = open ? "Hide these calls" : "Show these calls";
		row.setAttribute("aria-expanded", String(open));
		row.setAttribute("aria-label", `${calls.length} finished tool calls: ${slot.names.join(", ")}`);
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
		el.className = "live-say";
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

	/**
	 * One card, drawn.
	 *
	 * Three kinds, and the difference between them is the whole of what a mirror has to say
	 * about a transcript: yours is a bubble, a notice is a line, and the agent's is a run of
	 * parts — a reply with its thinking behind a disclosure, and the calls it made as rows.
	 *
	 * **The agent's card is a grouping, not a plate.** Its parts sit 8px apart and the cards
	 * 10px apart, which is the column's own arithmetic (`stream-roll` and the card's own gap),
	 * and is what makes a turn read as one object on a panel that is uniformly one colour. The
	 * column's cards carry a background because they float over a board; this one would be a
	 * box drawn in the box.
	 */
	function draw(card) {
		if (card.kind === "mine") {
			const el = document.createElement("div");
			el.className = "live-turn live-mine";
			el.dataset.item = card.id;
			const bubble = document.createElement("div");
			bubble.className = "live-bubble";
			// Verbatim, where the agent's side is markdown: it is the text that was sent.
			bubble.textContent = card.text;
			el.append(bubble);
			return el;
		}
		if (card.kind === "notice") {
			const el = document.createElement("div");
			el.className = "live-turn live-notice";
			el.dataset.item = card.id;
			el.dataset.level = card.level;
			el.textContent = card.text;
			return el;
		}
		const el = document.createElement("article");
		el.className = "live-turn live-agent";
		el.dataset.item = card.id;
		for (const part of card.parts) {
			if (part.kind === "tools") {
				const tools = document.createElement("div");
				tools.className = "live-tools";
				tools.dataset.item = part.id;
				for (const slot of part.slots) {
					tools.append(slot.kind === "group" ? groupRow(slot, part.slots.length === 1) : callRow(slot.call));
				}
				el.append(tools);
				continue;
			}
			el.append(sayRow(part));
		}
		return el;
	}

	/**
	 * The line that says the agent is still going, at the foot of the column.
	 *
	 * **The words are the app's, not this file's.** The column draws a card with the working
	 * sign in it — "working…" for a turn with nothing to read yet, "typing…" for an answer
	 * visibly arriving, "running tools…" for the long pause with no text in it — and
	 * `chat/working-sign.ts` is the one place that decides which. A mirror has no sign to draw,
	 * because the marks are the app's own svg, so it is a quiet line with a dot in the same
	 * words, sent in the feed.
	 *
	 * It used to work them out from the transcript, and could only tell that *something* was
	 * happening: all three states came out as "working…". Reading the items was defended as
	 * needing nothing new in the protocol, which was true and not worth the word it lost.
	 */
	function workingRow() {
		if (!working) return undefined;
		const el = document.createElement("div");
		el.className = "live-working";
		el.textContent = working;
		return el;
	}

	/**
	 * Redraw from `from` onwards.
	 *
	 * A card is self-contained now, so this is the simplest thing it could be: drop everything
	 * from `from` and append the rest. A card that grew — a streaming reply, a call that
	 * finished — is a card the app marked as changed, and its own id decides what is redrawn.
	 * Everything before it is untouched by construction, so a conversation of two thousand
	 * turns repaints one card when a turn arrives and one card per frame of it streaming.
	 */
	function render(from) {
		// The working line is not a card of the transcript and is rebuilt from the whole of it.
		list.querySelector(".live-working")?.remove();
		for (let index = list.children.length - 1; index >= from; index--) list.children[index].remove();
		for (let index = from; index < turns.length; index++) list.append(draw(turns[index]));
		const foot = workingRow();
		if (foot) list.append(foot);
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
		const before = turns.length;
		/*
		 * A `from` past the end of what this board holds is not an append: it would leave cards on
		 * screen that nothing describes, because `render` rebuilds from `from` and there is nothing
		 * there to rebuild from. The app never sends one — `liveDelta` answers with how many cards
		 * the two ends share — so this is about a malformed feed being a reset rather than a stale
		 * list.
		 */
		const from = feed.from > turns.length ? 0 : feed.from;
		turns = [...turns.slice(0, from), ...feed.turns];
		working = feed.working ?? "";
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
		const added = turns.length - before;
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
		if (typeof feed.from !== "number" || !Array.isArray(feed.turns)) return;
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
