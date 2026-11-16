// The pairing code on show in this server's Settings, who holds a token, and the link to Decks Studio.
import { createSignal } from "solid-js";
import type { PairedRow, StudioLinkRow } from "../state/types/index.ts";

/** The pairing code on show in this server's Settings, and who holds a token (the server's tokens). */
interface PairingState {
	code?: string;
	expires?: number;
	paired: PairedRow[];
	/** The link to Decks Studio, its key, when this harness has one. */
	studio?: StudioLinkRow;
}

const [pairing, setPairing] = createSignal<PairingState>({ paired: [] });

export { pairing, setPairing };
