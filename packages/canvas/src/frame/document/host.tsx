import type { JSX } from "solid-js";
import { ItemFrame, type ItemFrameProps } from "../kind-host.tsx";

/** What the page gives a document's frame: the document's file, by its path in the deck, and what to call it. */
export interface DocumentFrameProps extends ItemFrameProps {
	path: string;
	title: string;
}

/** A document whole, in a frame of its own on the page (`kind-host.tsx`), with the document kind inside it (`guest.tsx`). */
export function DocumentFrame(props: DocumentFrameProps): JSX.Element {
	return <ItemFrame {...props} kind="document" start={() => ({ document: { path: props.path } })} />;
}
