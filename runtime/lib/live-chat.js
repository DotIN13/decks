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
 */

const PIN_SLACK = 8;
const RETRY_MS = 250;
const RETRY_FOR_MS = 8000;

/**
 * One class per kind, and **one element per item, always**.
 *
 * A view that skipped a kind would put the item indices and the child indices out of step,
 * and the index in the feed is the only thing that says what to redraw. A kind this build
 * has never heard of gets a plain row rather than nothing.
 */
function classOf(item) {
	if (item.kind === "user") return "live-ask";
	if (item.kind === "assistant") return "live-say";
	if (item.kind === "tool") return "live-tool";
	if (item.kind === "notice") return "live-notice";
	return "live-other";
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
	const name = document.createElement("span");
	name.className = "live-name";
	name.textContent = "…";
	head.append(name);

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

	function draw(item) {
		const el = document.createElement("div");
		el.className = `live-turn ${classOf(item)}`;
		el.dataset.item = item.id;
		fill(el, item);
		return el;
	}

	function fill(el, item) {
		if (item.kind === "assistant") {
			// Markdown, and asynchronously: a turn that is still streaming is redrawn on
			// the next feed anyway, so a late paint costs nothing.
			el.textContent = item.text;
			if (item.text) void api.markdown(el, item.text);
			el.dataset.streaming = item.streaming ? "true" : "false";
			return;
		}
		if (item.kind === "tool") {
			el.textContent = `${item.name} · ${item.title}`;
			el.dataset.state = item.state;
			return;
		}
		if (item.kind === "notice") {
			el.textContent = item.text;
			el.dataset.level = item.level;
			return;
		}
		el.textContent = item.text;
	}

	/**
	 * Redraw from `from` onwards.
	 *
	 * Everything before it is untouched by construction — that is what the index in the
	 * feed means — so a conversation of two thousand turns repaints one node when a turn
	 * arrives, and one node again for every frame of it streaming.
	 */
	function render(from) {
		for (let index = list.children.length - 1; index >= from; index--) {
			list.children[index].remove();
		}
		for (let index = from; index < items.length; index++) {
			list.append(draw(items[index]));
		}
	}

	function receive(feed) {
		const before = items.length;
		items = [...items.slice(0, feed.from), ...feed.items];
		if (feed.identity) {
			name.textContent = feed.identity.name;
			if (feed.identity.color) host.style.setProperty("--live-accent", feed.identity.color);
		}
		render(feed.from);

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
