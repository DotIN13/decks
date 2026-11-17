import SquarePen from "lucide-solid/icons/square-pen";
import { DocumentFrame } from "@decks/canvas";
import { Icon } from "@decks/ui";
import { Show } from "solid-js";
import { canvasPass, cardAgentCall } from "../../canvases/pass.ts";
import { scheme } from "../../lib/theme.ts";
import type { Tab, TabKind } from "../kind.ts";
import { canvasOfPath } from "../open.ts";

/** What a document is called in the row: its file's name. */
const nameOf = (path: string | undefined) => path?.split("/").pop() ?? "Document";

/**
 * A document, as a kind of tab: the document whole, with its editor, its history and its review, in a
 * frame of its own (`@decks/canvas`, `DocumentFrame`: the frame every kind runs in, with the document
 * kind inside), on the pass of the canvas that places it: the one it was opened from, or the one whose
 * folder its file is in. Put away while it is not in front; what was typed is in its file.
 */
export const documentKind: TabKind = {
	name: "document",
	title: (tab) => nameOf(tab.target),
	icon: (props) => <Icon of={SquarePen} size={props.size ?? 16} />,
	view: (tab, parts) => (
		<Show when={tab()} keyed>
			{(shown) => <DocumentTab tab={shown} foot={parts.dock.dockCover()} />}
		</Show>
	),
};

function DocumentTab(props: { tab: Tab; foot: number }) {
	const path = props.tab.target ?? "";
	const canvas = props.tab.from ?? canvasOfPath(path);
	return (
		<div class="surface" data-surface="document">
			<Show when={canvas} fallback={<p class="tab-missing">This document is on no canvas of the deck.</p>}>
				<DocumentFrame path={path} title={nameOf(path)} canvas={canvas!} pass={canvasPass} dark={scheme() === "dark"} foot={props.foot} agent={cardAgentCall} />
			</Show>
		</div>
	);
}
