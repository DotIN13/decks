import type { ServerMessage } from "@decks/protocol";
import type { View } from "../calls/person-call.ts";
import type { RouteDeps } from "./routes/shared.ts";

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
	reply({ type: "deck.changed", deck: app.canvasState() });
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
	// And the shared browser, with the code the extension pairs with: the status card
	// shows it when nothing is connected yet, and the browser is where the user reads it.
	// Which canvases exist: the manager's list, and the name the pill shows beside the agent.
	reply(app.stagesMessage());
	reply({ type: "web.changed", status: app.web.status(), code: app.web.code() });
	reply(app.settings.message());
	reply(app.pairingMessage());
}
