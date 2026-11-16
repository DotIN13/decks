// The canvas library's line messages compat does not answer or tell yet: each with its owner and why.
// messages.test.ts fails on any other; take a row out when its message is handled.

export type Gap = { type: string; way: "sent" | "heard"; owner: string; why: string };

export const GAPS: Gap[] = [
	{ type: "stage.pen", way: "heard", owner: "Warden", why: "not a line message: the line tells a drawing whole as canvas.changed (README rule 4); stage.pen is the tab socket's" },
	{ type: "stage.pen.delta", way: "heard", owner: "Warden", why: "not a line message: the line tells a drawing whole as canvas.changed (README rule 4)" },
	...["doc.compiled", "doc.repo", "doc.remote", "doc.gdoc", "doc.gcomments"].map((type): Gap => ({ type, way: "heard", owner: "Folio", why: "LaTeX, git and Google Docs are not on the new server yet" })),
];
