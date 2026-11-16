import type { ClientMessage, ServerMessage } from "@decks/protocol";
import type { RouteDeps } from "./routes/shared.ts";
import { legacy } from "./tab-requests.ts";
import type { View } from "./tab-socket.ts";

/**
 * What a page is told when it connects, on the line or on the old tab socket, and how the old
 * socket's requests are answered as the tab that sent them.
 */

/**
 * The greeting: the whole truth on connect, so a reconnect is a refresh. Who is answering, the deck
 * as the conversation on screen sees it, what this install can run, the agents, the subscriptions,
 * the canvases, the shared browser, the settings and who is paired.
 */
export function greet(app: RouteDeps["app"], reply: (message: ServerMessage) => void, view?: View): void {
	// A new browser starts on the conversation last opened anywhere, and moves on its own after.
	if (view) view.focused = app.agents.looking()?.id;
	// Who is answering, first: a front end that holds several connections draws its controls from it.
	reply({ type: "harness.hello", backend: { name: app.deck.name, can: { agents: true, write: true, share: true } } });
	reply({ type: "deck.changed", deck: app.stageState() });
	/*
	 * And what this install can run.
	 *
	 * A property of the machine rather than of the deck, which is why it is a frame of
	 * its own: which runtimes exist, what to call them in a menu, and whether this
	 * machine can start them. The browser needs the last one to grey a row out — before
	 * this, the `+` menu offered all four everywhere, and the first prompt was where you
	 * found out that the binary was not installed.
	 */
	reply({ type: "harness.runtimes", list: app.runtimes() });
	for (const warning of app.deck.warnings) reply({ type: "harness.notice", level: "warn", text: warning });
	// The whole truth on connect, so a reconnect is a refresh: the deck, the
	// agents, and each one's transcript.
	app.agents.greet(reply);
	/*
	 * And the subscriptions, which used to arrive only when Settings was opened.
	 *
	 * Every conversation's model picker draws a row per account, so a browser that has
	 * not opened Settings had a picker with no Subscription section at all — the control
	 * for switching account was invisible until you visited an unrelated panel. The list
	 * is a property of the install, like the deck itself, so it belongs in the greeting.
	 *
	 * Late, deliberately: each row costs a `claude auth status`, so this resolves a
	 * second or two after the rest and the browser fills the section in when it lands.
	 */
	void app.accountList.publish(reply);
	// And the shared browser, with the code the extension pairs with: the status board
	// shows it when nothing is connected yet, and the browser is where the user reads it.
	// Which stages exist: the manager's list, and the name the pill shows beside the agent.
	reply(app.stagesMessage());
	reply({ type: "web.changed", status: app.web.status(), code: app.web.code() });
	reply(app.settings.message());
	reply(app.pairingMessage());
}

/**
 * One of the old tab socket's requests, answered by the table in `tab-requests.ts`.
 */
export function handleTabRequest(app: RouteDeps["app"], message: ClientMessage, reply: (message: ServerMessage) => void, view?: View): void {
	if (!view) {
		void legacy(app, message, reply);
		return;
	}
	/*
	 * Each browser has its own conversation, so a frame is handled as the browser that sent it.
	 *
	 * The registry keeps one "focused agent", which every frame about "the stage you are on" reads:
	 * a board moved, a board placed, a prompt with no id. Setting it to this browser's before the
	 * frame and reading it back after is what lets a phone and a laptop sit on two different
	 * conversations — without it, opening a chat on one moved the other to it too.
	 */
	app.agents.look(view.focused);
	app.pages.viewing = view;
	void legacy(app, message, reply, view).finally(() => {
		app.pages.viewing = undefined;
		view.focused = app.agents.looking()?.id;
	});
}
