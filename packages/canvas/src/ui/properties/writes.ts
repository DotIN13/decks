import { baseTheme, DECKS_COLORS, decksColorOf, resolve, type PenNode } from "@decks/pen";
import { setPenLive } from "../../edit/pen-tools.ts";
import { scheme } from "../../base/theme.ts";
import { MIXED, hexOf } from "./values.ts";
import type { PropertiesProps } from "./props.ts";

/** A change to some items: the fields each one is given, worked out from the item as it will be. */
export type SetFields = (nodes: readonly PenNode[], fields: (node: PenNode) => Record<string, unknown>) => void;

/** What `createWrites` reads of the panel (`../Properties.tsx`). */
export interface WritesNeeds {
	readonly props: PropertiesProps;
}

/** How the panel writes: an edit sent, the same change only drawn while a hand is still down, and what was sent and has not come back yet. */
export function createWrites(d: WritesNeeds) {
	const edit = (ops: unknown[]) => {
		if (ops.length) d.props.onEdit(ops);
	};

	/*
	 * What this panel has sent and the drawing does not have back yet, by item. An edit is built from
	 * the item as it will be: two quick clicks, heads then dash, each rewrite an arrow's whole
	 * metadata, and the second built from the item before the first came back undid the first.
	 */
	const sent = new Map<string, { fields: Record<string, unknown>; at: number }>();

	const asSent = (node: PenNode): PenNode => {
		const pending = sent.get(node.id);
		if (!pending) return node;
		const caughtUp = Object.entries(pending.fields).every(([field, value]) => JSON.stringify((node as unknown as Record<string, unknown>)[field] ?? null) === JSON.stringify(value ?? null));
		if (caughtUp || performance.now() - pending.at > 5000) {
			sent.delete(node.id);
			return node;
		}
		return { ...node, ...pending.fields } as PenNode;
	};

	const set = (nodes: readonly PenNode[], fields: (node: PenNode) => Record<string, unknown>) =>
		edit(
			nodes.map((node) => {
				const change = fields(asSent(node));
				sent.set(node.id, { fields: { ...(sent.get(node.id)?.fields ?? {}), ...change }, at: performance.now() });
				return { op: "update", id: node.id, set: change };
			}),
		);

	/**
	 * The same change, drawn on the stage and not saved: what a colour picker sends while the hand is
	 * still down, so the colour follows the pointer and the file takes one edit when it lifts
	 * (`state/pen-tools.ts`, `penLive`).
	 */
	const show = (nodes: readonly PenNode[], fields: (node: PenNode) => Record<string, unknown>) =>
		setPenLive(nodes.length ? nodes.map((node) => ({ id: node.id, set: fields(node) })) : undefined);

	const writer = (live?: boolean) => (live ? show : set);

	/** A colour control's live drag: each step drawn, nothing saved, and nothing is the drawing itself again. */
	const live = (apply: (color: string) => void) => (color?: string) => (color === undefined ? setPenLive(undefined) : apply(color));

	/** What a colour field's value comes to on the canvas now: a variable resolved in the drawing for the scheme, a hex as it is. */
	const shownOf = (value: string | typeof MIXED | undefined): string | undefined => {
		if (!value || value === MIXED) return undefined;
		if (!value.startsWith("$")) return value;
		const doc = d.props.doc;
		return (doc ? hexOf(resolve(doc, value, baseTheme(doc, scheme()))) : undefined) ?? DECKS_COLORS[decksColorOf(value) ?? ""]?.[scheme()];
	};

	return {
		writer,
		edit,
		set,
		shownOf,
		live,
		show,
	};
}
