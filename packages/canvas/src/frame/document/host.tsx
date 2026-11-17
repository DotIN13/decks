import type { JSX } from "solid-js";
import { ItemFrame, type ItemLookProps, type ItemPass } from "../kind-host.tsx";

/** What the page gives a document's frame: the document's file, by its path in the deck, what to call it, and the pass for it (a document pass). */
export interface DocumentFrameProps extends ItemLookProps {
	path: string;
	title: string;
	pass: (path: string) => Promise<ItemPass>;
}

/** A document whole, in a frame of its own on the page (`kind-host.tsx`), with the document kind inside it (`guest.tsx`). */
export function DocumentFrame(props: DocumentFrameProps): JSX.Element {
	return <ItemFrame dark={props.dark} foot={props.foot} agent={props.agent} kind="document" title={props.title} pass={() => props.pass(props.path)} start={() => ({ document: { path: props.path } })} />;
}
