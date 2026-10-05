import type { Frame, PenNode, Placed } from "@decks/pen";

/**
 * Items that have been turned, and the arithmetic every part of the canvas needs to agree about
 * one.
 *
 * pen gives an item a `rotation` in degrees counter-clockwise **about its own top-left corner**
 * (`types.ts`), and the painter turns the canvas by it (`paint.ts`). Everything else about an item
 * is upright: `layout` puts it in an axis-aligned box, `boundsOf` measures that box, and a press is
 * tested against it. So a turned item was drawn in one place and clicked, outlined and sized in
 * another.
 *
 * The fix is one matrix. `matrixOf` is the turn an item has been given, including any its parents
 * were given, as a 2 by 3 affine matrix from the upright stage coordinates that everything else
 * computes in, to where the item is really drawn. Apply it to put a handle where the eye expects it
 * (`applyTurn`), invert it to carry a press back to the upright box (`invertTurn`), and use its
 * linear part alone to turn a drag's direction (`linearTurn`). Nothing else in the canvas has to know the angle.
 */

/** `[a, b, c, d, e, f]`: x' = a x + c y + e, y' = b x + d y + f. The same order CSS and SVG take. */
export type Matrix = readonly [number, number, number, number, number, number];

export const UNTURNED: Matrix = [1, 0, 0, 1, 0, 0];

export function isUnturned(m: Matrix): boolean {
	return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

/** One matrix after another: `after` applied to the result of `first`. */
export function compose(after: Matrix, first: Matrix): Matrix {
	const [a, b, c, d, e, f] = after;
	const [a2, b2, c2, d2, e2, f2] = first;
	return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
}

export function applyTurn(m: Matrix, point: { x: number; y: number }): { x: number; y: number } {
	return { x: m[0] * point.x + m[2] * point.y + m[4], y: m[1] * point.x + m[3] * point.y + m[5] };
}

/** A direction, turned: the matrix's linear part, with no shift. */
export function linearTurn(m: Matrix, vector: { x: number; y: number }): { x: number; y: number } {
	return { x: m[0] * vector.x + m[2] * vector.y, y: m[1] * vector.x + m[3] * vector.y };
}

export function invertTurn(m: Matrix): Matrix {
	const [a, b, c, d, e, f] = m;
	const det = a * d - b * c;
	if (!det) return UNTURNED;
	return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** Degrees counter-clockwise, as a turn about a point: the matrix of it. */
export function turn(deg: number, about: { x: number; y: number }): Matrix {
	if (!deg) return UNTURNED;
	const rad = (deg * Math.PI) / 180;
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	// Counter-clockwise with y down, which is how the painter turns the canvas.
	const linearPart: Matrix = [c, -s, s, c, 0, 0];
	return compose([1, 0, 0, 1, about.x, about.y], compose(linearPart, [1, 0, 0, 1, -about.x, -about.y]));
}

/** An item's own angle, in degrees counter-clockwise, or 0. */
export function angleOf(node: PenNode | undefined): number {
	const deg = node?.rotation;
	return typeof deg === "number" && Number.isFinite(deg) ? deg : 0;
}

/** An item's own angle plus every angle it inherits from the items it sits in. */
export function totalAngle(placed: ReadonlyMap<string, Placed>, id: string): number {
	let deg = 0;
	for (let at = placed.get(id); at; at = at.parent ? placed.get(at.parent) : undefined) deg += angleOf(at.node);
	return deg;
}

/**
 * Where an item is really drawn, as a matrix from the upright stage coordinates: its own turn about
 * its own corner, after the turns of everything it sits in. The identity for an item nobody turned,
 * which is nearly all of them.
 */
export function matrixOf(placed: ReadonlyMap<string, Placed>, id: string): Matrix {
	const own = placed.get(id);
	return own ? compose(matrixAbove(placed, id), turn(angleOf(own.node), { x: own.box.x, y: own.box.y })) : UNTURNED;
}

/**
 * The turns an item inherits from the items it sits in, without its own: what to compose a turn
 * about a box being dragged with, so the handles stay on an item while it is sized.
 */
export function matrixAbove(placed: ReadonlyMap<string, Placed>, id: string): Matrix {
	const parent = placed.get(id)?.parent;
	return parent ? matrixOfChain(placed, parent) : UNTURNED;
}

function matrixOfChain(placed: ReadonlyMap<string, Placed>, id: string): Matrix {
	const chain: Placed[] = [];
	for (let at = placed.get(id); at; at = at.parent ? placed.get(at.parent) : undefined) chain.push(at);
	let m = UNTURNED;
	// Outermost first: each turn is about its own corner, in the coordinates the turns outside it left.
	for (const at of chain.reverse()) {
		const deg = angleOf(at.node);
		if (deg) m = compose(m, turn(deg, { x: at.box.x, y: at.box.y }));
	}
	return m;
}

/** A box's four corners, in the order north-west, north-east, south-east, south-west. */
export function cornersOf(box: Frame): Array<{ x: number; y: number }> {
	return [
		{ x: box.x, y: box.y },
		{ x: box.x + box.w, y: box.y },
		{ x: box.x + box.w, y: box.y + box.h },
		{ x: box.x, y: box.y + box.h },
	];
}

/**
 * A matrix for a box drawn at its own top-left, which is what an absolutely placed element needs:
 * the linear part as it is, and a shift that puts the box's own corner where the turn leaves it.
 */
export function forBox(m: Matrix, box: { x: number; y: number }): Matrix {
	const moved = applyTurn(m, box);
	return [m[0], m[1], m[2], m[3], moved.x - box.x, moved.y - box.y];
}

export function cssTurn(m: Matrix): string {
	const n = (value: number) => Math.round(value * 1e4) / 1e4;
	return `matrix(${n(m[0])}, ${n(m[1])}, ${n(m[2])}, ${n(m[3])}, ${n(m[4])}, ${n(m[5])})`;
}
