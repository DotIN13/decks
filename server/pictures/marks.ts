import type { PenNode } from "@decks/pen";

// What the canvas draws on items beyond pen's own page (rule 15): a card's
// frame from its item's corner, outline and shadow, and a placeholder frame's
// dashed edge in the writer's colour, with the writer's name on a tag.

export type Writer = { name?: string; color: string };
export const ACCENT = "#3b5cf6";
const num = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const colour = (value: unknown) => (typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value) ? value : undefined);
const quote = (text: string) => `"${text.replace(/["\\\n]/g, " ")}"`;
const target = (id: string) => `[data-pen-id="${id.replace(/"/g, "")}"]`;

/** The marks for every item in the tree, as one stylesheet. */
export function marks(nodes: PenNode[], writer: Writer | undefined): string {
	const out: string[] = [];
	const walk = (node: PenNode) => {
		const meta = node.metadata as { type?: unknown } | undefined;
		if (node.type === "browser" && meta?.type === "decks.card") {
			const css = cardFrame(node);
			if (css) out.push(css);
		}
		if (node.type === "frame" && node.placeholder === true) out.push(placeholderMark(node, writer));
		for (const child of (node.children as PenNode[] | undefined) ?? []) walk(child);
	};
	for (const node of nodes) walk(node);
	return out.join("\n");
}

/** A card's own frame: its corner, an outline by its alignment, and its shadows. */
export function cardFrame(node: PenNode): string | undefined {
	const parts: string[] = [];
	if (typeof node.cornerRadius === "number") parts.push(`border-radius: ${Math.max(0, node.cornerRadius)}px !important;`);
	const stroke = colour(node.stroke);
	const width = num(node.strokeWidth, stroke ? 1 : 0);
	if (stroke && width > 0) {
		const offset = node.strokeAlignment === "outer" ? 0 : node.strokeAlignment === "inner" ? -width : -width / 2;
		parts.push(`outline: ${width}px solid ${stroke} !important; outline-offset: ${offset}px !important;`);
	}
	const effects = (Array.isArray(node.effect) ? node.effect : node.effect ? [node.effect] : []) as Record<string, unknown>[];
	const shadows = effects.filter((e) => e?.type === "shadow" && colour(e.color)).map((e) => {
		const at = (e.offset ?? {}) as { x?: unknown; y?: unknown };
		return `${num(at.x)}px ${num(at.y)}px ${num(e.blur)}px ${num(e.spread)}px ${colour(e.color)}`;
	});
	if (shadows.length) parts.push(`box-shadow: ${shadows.join(", ")} !important;`);
	return parts.length ? `${target(String(node.id))} { ${parts.join(" ")} }` : undefined;
}

/** A placeholder frame's dashed edge just inside it, and the writer's tag in its corner. */
export function placeholderMark(node: PenNode, writer: Writer | undefined): string {
	const c = writer?.color ?? ACCENT;
	const at = target(String(node.id));
	const edge = `${at}::after { content: ""; position: absolute; inset: 0; box-sizing: border-box; border: 2px dashed ${c}; border-radius: inherit; pointer-events: none; z-index: 2; }`;
	const name = writer?.name?.trim();
	if (!name) return edge;
	return `${edge}\n${at}::before { content: ${quote(name)}; position: absolute; left: 6px; top: 6px; padding: 3px 6px; border-radius: 4px; background: ${c}; color: #fff; font: 600 12px Inter, system-ui, sans-serif; z-index: 3; }`;
}

