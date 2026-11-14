import type { Item, ItemKind, PenNode } from "../kernel/types.ts";

// Who owns a node: a kind another feature registers, claimed by the node's
// metadata.type "decks.<type>", or else the drawing itself, kept as written.

/** The drawn kinds, said once: what pen.dev itself draws. */
export const DRAWN = ["note", "text", "rectangle", "ellipse", "polygon", "path", "line", "frame", "group", "icon", "icon_font", "ref", "prompt", "context", "script", "browser"] as const;

export class Kinds {
	private byType = new Map<string, ItemKind>();

	constructor(kinds: readonly ItemKind[] = []) {
		for (const kind of kinds) this.add(kind);
	}

	add(kind: ItemKind): void {
		if (this.byType.has(kind.type)) throw new Error(`Two item kinds are called ${kind.type}.`);
		if ((DRAWN as readonly string[]).includes(kind.type)) throw new Error(`${kind.type} is drawn by pen.dev, and no feature may claim it.`);
		this.byType.set(kind.type, kind);
	}

	/** The registered kind that claims a node, if any. */
	of(node: PenNode): ItemKind | undefined {
		const tag = (node.metadata as { type?: unknown } | undefined)?.type;
		if (typeof tag !== "string" || !tag.startsWith("decks.")) return undefined;
		return this.byType.get(tag.slice("decks.".length));
	}

	/** A registered kind by an item's type. */
	named(type: string): ItemKind | undefined {
		return this.byType.get(type);
	}

	/** A pen node as the calls answer it. Drawn nodes pass through. */
	toItem(node: PenNode, canvas: string): Item {
		const kind = this.of(node);
		if (!kind) return node as Item;
		const item = kind.fromPen(node, { canvas });
		return { ...item, id: node.id ?? item.id };
	}

	/** An item as the file keeps it; its box is a place, never saved. */
	toNode(item: Item, canvas: string): PenNode {
		const { box: _box, ...rest } = item;
		const kind = this.named(item.type);
		if (!kind) return rest as PenNode;
		const node = kind.toPen(item, { canvas });
		return item.id && !node.id ? { ...node, id: item.id } : node;
	}

	/** The deck files an item needs, as its kind says. */
	filesOf(node: PenNode, canvas: string): string[] {
		const kind = this.of(node);
		return kind?.files ? kind.files(this.toItem(node, canvas)) : [];
	}
}
