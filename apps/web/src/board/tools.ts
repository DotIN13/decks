/**
 * What a click on the canvas means: **browse** reads the boards (text selects, a game plays, a
 * link opens) and still moves and retypes what is drawn; **edit** is for changing the drawing,
 * with its outlines, grips and distances. A board's own page is never edited from the canvas.
 */
export type CanvasMode = "browse" | "edit";
