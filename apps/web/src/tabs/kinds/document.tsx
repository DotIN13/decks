import SquarePen from "lucide-solid/icons/square-pen";
import { DocumentFrame } from "@decks/canvas/page";
import { Icon } from "@decks/ui";
import { createResource, For, Match, Switch } from "solid-js";
import { cardAgentCall, documentPass } from "../../canvases/pass.ts";
import { scheme } from "../../lib/theme.ts";
import { act } from "../../state/decks.ts";
import type { Tab, TabKind } from "../kind.ts";
import { ITEM_KINDS, ITEMS_BEHIND } from "../budget.ts";
import { aliveAmong } from "../tabs.ts";

/** What a document is called in the row: its file's name. */
const nameOf = (path: string | undefined) => path?.split("/").pop() ?? "Document";

/**
 * A document, as a kind of tab: the document whole, with its editor, its history and its review, in a
 * frame of its own (`@decks/canvas`, `DocumentFrame`: the frame every kind runs in, with the document
 * kind inside), on a pass for that document alone, so it opens whether a canvas places it or not. Kept
 * alive behind the tab in front, within the device's budget (`budget.ts`), where it was scrolled to
 * and all; one past the budget is put away, and what was typed is in its file.
 */
export const documentKind: TabKind = {
	name: "document",
	address: "doc",
	title: (tab) => nameOf(tab.target),
	offers: {
		label: "Documents",
		// The files a document can be, by their endings, wherever they are in the deck.
		list: async () => {
			const found = await Promise.all(["*.md", "*.tex", "*.docx"].map((pattern) => act<Array<{ path: string; dir?: true }>>("file.find", [pattern, { limit: 500 }])));
			return found.flatMap((files) => (files ?? []).filter((file) => !file.dir).map((file) => ({ target: file.path, title: nameOf(file.path), note: file.path.split("/").slice(0, -1).join("/") })));
		},
	},
	icon: (props) => <Icon of={SquarePen} size={props.size ?? 16} />,
	view: (tab, parts) => <For each={aliveAmong(ITEM_KINDS, ITEMS_BEHIND).filter((one) => one.kind === "document")}>{(one) => <DocumentTab tab={one} shown={tab()?.id === one.id} foot={parts.dock.dockCover()} />}</For>,
};

function DocumentTab(props: { tab: Tab; shown: boolean; foot: number }) {
	const path = props.tab.target ?? "";
	/*
	 * The first pass is asked for here, so a document that is gone (a row kept from last week, a file
	 * since deleted) is said in the tab; the frame is handed that one, and asks for each later one itself.
	 */
	const [first] = createResource(() => documentPass(path).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error)))));
	let handed = false;
	return (
		<div class="surface" data-surface="document" data-kept={props.shown ? undefined : "true"} style={{ visibility: props.shown ? undefined : "hidden", "pointer-events": props.shown ? undefined : "none" }}>
			<Switch>
				<Match when={first() instanceof Error}>
					<p class="tab-missing">This document is not in the deck any more.</p>
				</Match>
				<Match when={first()}>
					{(held) => (
						<DocumentFrame
							path={path}
							title={nameOf(path)}
							pass={(asked) => {
								if (handed) return documentPass(asked);
								handed = true;
								return Promise.resolve(held() as Awaited<ReturnType<typeof documentPass>>);
							}}
							dark={scheme() === "dark"}
							foot={props.foot}
							agent={cardAgentCall}
						/>
					)}
				</Match>
			</Switch>
		</div>
	);
}
