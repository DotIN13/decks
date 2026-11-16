// The canvas library's line messages compat does not answer or tell yet: each with its owner and why.
// messages.test.ts fails on any other; take a row out when its message is handled.

export type Gap = { type: string; way: "sent" | "heard"; owner: string; why: string };

export const GAPS: Gap[] = [
	{ type: "stage.pen", way: "heard", owner: "Warden", why: "not a line message: the line tells a drawing whole as canvas.changed (README rule 4); stage.pen is the tab socket's" },
	{ type: "stage.pen.delta", way: "heard", owner: "Warden", why: "not a line message: the line tells a drawing whole as canvas.changed (README rule 4)" },
	{ type: "app.changed", way: "heard", owner: "Warden", why: "told only by the generic pass-through, without the name the frame looks its app's windows up by: an app's window never hears its state" },
	{ type: "agent.act", way: "heard", owner: "Warden", why: "told only by the generic pass-through, without the path the frame reads: no agent's glow or cursor on a card, and a path-less act can throw" },
	...["doc.open", "doc.close", "doc.patch", "doc.review", "doc.versions", "doc.version", "doc.restore"].map((type): Gap => ({ type, way: "sent", owner: "Warden", why: "the documents bridge, being built with Folio: a document page cannot open" })),
	...["doc.compile", "doc.git", "doc.gstyle", "doc.gcomment"].map((type): Gap => ({ type, way: "sent", owner: "Folio", why: "LaTeX, git and Google Docs are not on the new server yet" })),
	...["doc.state", "doc.patched", "doc.changed", "doc.versions", "doc.version"].map((type): Gap => ({ type, way: "heard", owner: "Warden", why: "the documents bridge, being built with Folio" })),
	...["doc.compiled", "doc.repo", "doc.remote", "doc.gdoc", "doc.gcomments"].map((type): Gap => ({ type, way: "heard", owner: "Folio", why: "LaTeX, git and Google Docs are not on the new server yet" })),
];
