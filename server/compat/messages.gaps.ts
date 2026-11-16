// The canvas library's line messages compat does not answer or tell yet: each with its owner and why;
// and those that are not this line's at all.
// messages.test.ts fails on any other; take a row out when its message is handled.

export type Gap = { type: string; way: "sent" | "heard"; owner: string; why: string };

export const GAPS: Gap[] = [
	...["doc.remote", "doc.gdoc", "doc.gcomments"].map((type): Gap => ({ type, way: "heard", owner: "Folio", why: "Google Docs are not on the new server yet" })),
];

/**
 * Not this line's: the frame hears them on the tab socket, and the line tells a drawing whole as
 * canvas.changed instead (README rule 4), which the frame takes in their place.
 */
export const NOT_THIS_LINE = ["stage.pen", "stage.pen.delta"];
