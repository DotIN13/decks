/**
 * The status card for the user's own Chrome, shared with the deck.
 *
 * A board with `data-live="web"` draws nothing from its file: the app posts the shared
 * browser's state in (`canvas/live-chat.ts` → `live.web`), and this draws it. There is no
 * picture of the tab on purpose — the tab is on the user's own screen, in the Chrome the
 * extension runs in — so the card says which tab is shared, whether it is connected, what
 * the agent has done, and carries the two things the user decides: Allow or Deny for a
 * submit the agent asked leave for, and Stop.
 *
 * When nothing is paired yet it shows what to paste into the extension: this page's own
 * origin, which is the address the browser reached Decks at, and the pairing code the
 * server sent with the status.
 */

const RETRY_MS = 250;
const RETRY_FOR_MS = 8000;

export function mountLiveWeb(host) {
	host.textContent = "";
	host.classList.add("web");

	const head = document.createElement("div");
	head.className = "live-head";
	const dot = document.createElement("span");
	dot.className = "web-dot";
	const name = document.createElement("span");
	name.className = "live-name";
	name.textContent = "Your Chrome";
	const state = document.createElement("span");
	state.className = "web-state";
	head.append(dot, name, state);

	const body = document.createElement("div");
	body.className = "live-list web-body";
	body.style.overflowY = "auto";

	host.append(head, body);

	let answered = false;
	const post = (message) => window.parent?.postMessage(message, "*");

	function draw(status, code) {
		answered = true;
		body.textContent = "";
		host.dataset.state = status.connected ? "connected" : status.paired ? "waiting" : "unpaired";
		dot.dataset.on = status.connected ? "true" : "false";
		state.textContent = status.connected ? "connected" : status.paired ? "not connected" : "not paired";

		if (!status.paired || (!status.connected && code && status.tabs.length === 0)) {
			const how = document.createElement("div");
			how.className = "web-how";
			const title = document.createElement("div");
			title.className = "web-title";
			title.textContent = status.paired ? "Share a tab from the Decks extension" : "Pair the Decks extension";
			const steps = document.createElement("ol");
			for (const step of [
				"Open the Decks extension's popup in Chrome.",
				`Address: ${location.origin}`,
				`Code: ${code ?? "(ask the agent: stage.web.pairing())"}`,
				"Save, then press “Share this tab” on the tab the agent should work in.",
			]) {
				const li = document.createElement("li");
				li.textContent = step;
				steps.append(li);
			}
			how.append(title, steps);
			body.append(how);
		}

		if (status.tabs.length > 0) {
			const tabs = document.createElement("div");
			tabs.className = "web-tabs";
			for (const tab of status.tabs) {
				const row = document.createElement("div");
				row.className = "web-tab";
				const title = document.createElement("div");
				title.className = "web-title";
				title.textContent = tab.title || "(untitled)";
				const url = document.createElement("div");
				url.className = "web-url";
				url.textContent = tab.url;
				row.append(title, url);
				tabs.append(row);
			}
			body.append(tabs);
		} else if (status.closed && status.paired) {
			const why = document.createElement("div");
			why.className = "web-note";
			why.textContent = `Last connection ended: ${status.closed}`;
			body.append(why);
		}

		if (status.pending) {
			const ask = document.createElement("div");
			ask.className = "web-ask";
			const text = document.createElement("div");
			text.textContent = status.pending.text;
			const buttons = document.createElement("div");
			buttons.className = "web-buttons";
			const allow = document.createElement("button");
			allow.type = "button";
			allow.className = "web-allow";
			allow.textContent = "Allow";
			allow.addEventListener("click", () => post({ decks: "live.web.answer", id: status.pending.id, ok: true }));
			const deny = document.createElement("button");
			deny.type = "button";
			deny.textContent = "Deny";
			deny.addEventListener("click", () => post({ decks: "live.web.answer", id: status.pending.id, ok: false }));
			buttons.append(allow, deny);
			ask.append(text, buttons);
			body.append(ask);
		}

		if (status.actions.length > 0) {
			const list = document.createElement("div");
			list.className = "web-actions";
			for (const action of status.actions.slice().reverse()) {
				const row = document.createElement("div");
				row.className = "web-action";
				row.dataset.ok = action.ok ? "true" : "false";
				const when = document.createElement("span");
				when.className = "web-when";
				when.textContent = new Date(action.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
				const what = document.createElement("span");
				what.textContent = action.text;
				row.append(when, what);
				list.append(row);
			}
			body.append(list);
		}

		if (status.connected) {
			const stop = document.createElement("button");
			stop.type = "button";
			stop.className = "web-stop";
			stop.textContent = "Stop sharing";
			stop.addEventListener("click", () => post({ decks: "live.web.stop" }));
			body.append(stop);
		}
	}

	window.addEventListener("message", (event) => {
		if (event.source !== window.parent) return;
		const feed = event.data;
		if (!feed || feed.decks !== "live.web" || !feed.status) return;
		draw(feed.status, feed.code);
	});

	const want = { decks: "live.want", kind: "web" };
	const ask = () => post(want);
	ask();
	const started = Date.now();
	const timer = setInterval(() => {
		if (answered || Date.now() - started > RETRY_FOR_MS) {
			clearInterval(timer);
			if (!answered) {
				host.dataset.state = "alone";
				state.textContent = "not in the app";
			}
			return;
		}
		ask();
	}, RETRY_MS);
}
