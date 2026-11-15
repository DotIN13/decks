import { toDeckPath, type DeckPath, type Item, type ItemKind } from "../kernel/index.ts";
import { APP_NAME, manifestOf } from "./manifest.ts";

// The app as an item kind: { type: "app", app, title?, box } on a call, a
// browser node tagged decks.app in canvas.pen. A node keeps every field it had.

const TAG = "decks.app";
const OWN = new Set(["type", "id", "x", "y", "width", "height", "name", "url"]);
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

export const appKind: ItemKind = {
	type: "app",
	fromPen(node) {
		const meta = (node.metadata ?? {}) as { name?: unknown };
		const app = typeof meta.name === "string" ? meta.name : String(node.url ?? "").replace(/^\/app\/|\/$/g, "");
		const rest = Object.fromEntries(Object.entries(node).filter(([key]) => !OWN.has(key)));
		const x = num(node.x, 0);
		const y = num(node.y, 0);
		return {
			...rest,
			type: "app",
			...(node.id === undefined ? {} : { id: node.id }),
			app,
			...(typeof node.name === "string" ? { title: node.name } : {}),
			box: { x1: x, y1: y, x2: x + num(node.width, 1100), y2: y + num(node.height, 760) },
		} as Item;
	},
	toPen(item) {
		const { type: _type, app, title, box, ...rest } = item;
		const name = String(app ?? "");
		const meta = (rest.metadata ?? {}) as Record<string, unknown>;
		const b = box ?? { x1: 0, y1: 0, x2: 1100, y2: 760 };
		return {
			type: "browser",
			...(item.id === undefined ? {} : { id: item.id }),
			...(title === undefined ? {} : { name: title }),
			url: `/app/${name}/`,
			width: b.x2 - b.x1,
			height: b.y2 - b.y1,
			...rest,
			metadata: { ...meta, type: TAG, name },
			x: b.x1,
			y: b.y1,
		};
	},
	/** An app placed with no title takes its app's title, as its pen name. */
	async prepare(item, at) {
		if (typeof item.title === "string" || !at.deck || !APP_NAME.test(String(item.app ?? ""))) return item;
		const manifest = await manifestOf(at.deck, String(item.app)).catch(() => undefined);
		return { ...item, title: manifest?.title ?? String(item.app) };
	},
	files(item): DeckPath[] {
		const name = String(item.app ?? "");
		return APP_NAME.test(name) ? [toDeckPath(`apps/${name}`)] : [];
	},
};
