// Where a pill's ⋯ menu sits: under the ⋯ button, 4 px to its left, and kept
// 8 px inside the canvas on both sides. In px from the pill's left edge.

type Edges = { left: number; right: number };

export function menuLeft(canvas: Edges, pill: { left: number }, button: { left: number }, width: number): number {
	return Math.max(canvas.left + 8 - pill.left, Math.min(button.left - 4 - pill.left, canvas.right - 8 - width - pill.left));
}
