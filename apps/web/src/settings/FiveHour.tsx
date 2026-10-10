import type { ClaudeAccount } from "@decks/protocol";
import { Show } from "solid-js";
import { usageLevel } from "../lib/context-usage.ts";
import { ago, resetsAt } from "./usage-format.ts";

/**
 * An account's 5-hour window, on its row: "xx% used", and nothing else.
 *
 * The same reading in the model picker and in settings (`fiveHour` on `ClaudeAccount`, kept by
 * the server from each reply's own limit report and a usage read for the accounts nobody is
 * talking to). Grey, then the usage panel's amber and red from `usageLevel`; a used-up account
 * is red at "100% used" like any other figure. Which window it is, when it starts again and how
 * old the reading is are in the tooltip: the row is for choosing, and the share is what the
 * choice turns on.
 */
export default function FiveHour(props: { reading: ClaudeAccount["fiveHour"] }) {
	return (
		<Show when={props.reading}>
			{(reading) => {
				const again = () => (reading().resetsAt ? resetsAt(new Date(reading().resetsAt!).toISOString(), Date.now()) : null);
				const title = () => `5-hour window${again() ? `, starts again at ${again()}` : ""}. Read ${ago(reading().at, Date.now())}.`;
				return (
					<span class="five-hour" data-level={reading().percent >= 100 ? "high" : usageLevel(reading().percent)} title={title()}>
						{Math.min(100, reading().percent)}% used
					</span>
				);
			}}
		</Show>
	);
}
