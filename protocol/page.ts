import { arr, bool, int, lit, named, nul, num, obj, opt, str, union, type Infer } from "./schema.ts";
import { Box, Camera, Point, Size } from "./shapes.ts";

// What the canvas library draws and says, with names from the glossary:
// a page placed on a canvas, a screen's presence, and who made a change.
// They replace the old protocol's Page, Presence and ChangeAuthor.

export const Presence = named(
	"Presence",
	obj({ pointer: opt(union(Point, nul)), selection: opt(arr(str())), camera: opt(union(Camera, nul)), gone: opt(bool()) }),
	"Where a screen points, what it selected and where it looks: what view.update takes and view.changed says.",
);

export const ChangeAuthor = named(
	"ChangeAuthor",
	obj({ kind: lit("person", "agent", "file", "studio"), id: opt(str()), name: opt(str()) }),
	"Who made one write of a canvas: the person, an agent, a hand edit of the file, or Studio.",
);

export const Page = named(
	"Page",
	obj({
		path: str(),
		title: str(),
		box: Box,
		rev: int(),
		shell: opt(lit("content", "foreign")),
		live: opt(str()),
		fills: opt(bool()),
		item: opt(lit("card", "document", "app")),
		file: opt(str()),
		app: opt(str()),
		sized: opt(bool()),
		corners: opt(arr(num(), "Four corner radii: top left, top right, bottom right, bottom left.")),
		outlined: opt(bool()),
		poster: opt(str()),
		content: opt(Size),
		clipped: opt(bool()),
		inPlay: arr(str("An agent whose conversation has it in play.")),
		by: opt(str()),
		named: opt(num()),
		changed: opt(num()),
		seen: opt(num()),
	}),
	"A card, document or app as a canvas frame draws it: its place, its revision, and whether it is news.",
);

export type Presence = Infer<typeof Presence>;
export type ChangeAuthor = Infer<typeof ChangeAuthor>;
export type Page = Infer<typeof Page>;
