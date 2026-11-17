import SquarePen from "lucide-solid/icons/square-pen";
import { DocumentFrame } from "@decks/canvas";
import { Icon } from "@decks/ui";
import { Show } from "solid-js";
import { cardAgentCall, documentPass } from "../../canvases/pass.ts";
import { scheme } from "../../lib/theme.ts";
import { act } from "../../state/decks.ts";
import type { Tab, TabKind } from "../kind.ts";

/** What a document is called in the row: its file's name. */
const nameOf = (path: string | undefined) => path?.split("/").pop() ?? "Document";

/**
 * A document, as a kind of tab: the document whole, with its editor, its history and its review, in a
 * frame of its own (`@decks/canvas`, `DocumentFrame`: the frame every kind runs in, with the document
 * kind inside), on a pass for that document alone, so it opens whether a canvas places it or not. Put
 * away while it is not in front; what was typed is in its file.
 */
export const documentKind: TabKind = {
	name: "document",
	address: "doc",
	title: (tab) => nameOf(tab.target),
	says: (tab) => (tab.target ? `the document @${tab.target}` : undefined),
	offers: {
		label: "Documents",
		// The files a document can be, by their endings, wherever they are in the deck.
		list: async () => {
			const found = await Promise.all(["*.md", "*.tex", "*.docx"].map((pattern) => act<Array<{ path: string; dir?: true }>>("file.find", [pattern, { limit: 500 }])));
			return found.flatMap((files) => (files ?? []).filter((file) => !file.dir).map((file) => ({ target: file.path, title: nameOf(file.path), note: file.path.split("/").slice(0, -1).join("/") })));
		},
	},
	icon: (props) => <Icon of={SquarePen} size={props.size ?? 16} />,
	view: (tab, parts) => (
		<Show when={tab()} keyed>
			{(shown) => <DocumentTab tab={shown} foot={parts.dock.dockCover()} />}
		</Show>
	),
};

function DocumentTab(props: { tab: Tab; foot: number }) {
	const path = props.tab.target ?? "";
	return (
		<div class="surface" data-surface="document">
			<DocumentFrame path={path} title={nameOf(path)} pass={documentPass} dark={scheme() === "dark"} foot={props.foot} agent={cardAgentCall} />
		</div>
	);
}
