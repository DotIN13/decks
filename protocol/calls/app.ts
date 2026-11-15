import { defineCall } from "../call.ts";
import { arr, int, lit, num, opt, str } from "../schema.ts";
import { App, AppCheck, Deleted, Source } from "../shapes.ts";
import { NOT_CARD, PEOPLE, PERSON } from "./parts.ts";

// Apps: folders in apps/ the server serves, builds or runs. Each is a git
// repository. Shown on a canvas by item.insert({ type: app, app: <name> }).

const Name = str("The app's folder name in apps/.");

export const list = defineCall({ name: "app.list", summary: "Every app in the deck, with its state.", who: NOT_CARD, args: {}, answer: arr(App), effect: "read" });

export const get = defineCall({
	name: "app.get",
	summary: "One app's state and its repository: branch, last commit, changed files, origin.",
	who: NOT_CARD,
	args: { name: Name },
	answer: App,
	effect: "read",
});

export const create = defineCall({
	name: "app.create",
	summary: "A new app from a starter, committed as a new repository: in the deck, or at source, which only the person may name.",
	who: PEOPLE,
	args: { name: Name, starter: opt(lit("static", "node", "solid", "react", "next")), title: opt(str()), source: opt(Source) },
	answer: App,
	effect: "change",
});

export const update = defineCall({
	name: "app.update",
	summary: "Mark an app's state as seen by the person, or point the deck at where its source now is.",
	who: PERSON,
	args: { name: Name, seen: opt(num("When the person looked, epoch ms.")), source: opt(Source) },
	answer: App,
	effect: "change",
});

export const clone = defineCall({
	name: "app.clone",
	summary: "Take in an app from an https or git address, into the deck or the folder to, which only the person may name. Nothing is installed or run.",
	who: PEOPLE,
	args: { url: str(), name: opt(Name), title: opt(str()), to: opt(str("A folder on this machine, outside the deck.")) },
	answer: App,
	effect: "change",
});

const act = (action: "build" | "run" | "stop" | "restart", summary: string) =>
	defineCall({ name: `app.${action}`, summary, who: PEOPLE, args: { name: Name }, answer: App, effect: "change" });

export const build = act("build", "Build an app, waiting up to 15 s; status building means ask app.get later.");
export const run = act("run", "Start an app, waiting up to 15 s.");
export const stop = act("stop", "Stop an app.");
export const restart = act("restart", "Stop and start an app after a code change. Items showing it reload.");

export const move = defineCall({
	name: "app.move",
	summary: "Move an app's source to a folder on this machine, outside the deck; the deck keeps its record and where it went. From then on its files are edited on disk, not through file calls.",
	who: PERSON,
	args: { name: Name, to: str("A folder on this machine.") },
	answer: App,
	effect: "change",
});

export const remove = defineCall({
	name: "app.delete",
	summary: "Stop an app, move its folder to the deck's trash, and take its items off the canvases.",
	who: PEOPLE,
	args: { name: Name },
	answer: Deleted,
	effect: "change",
});

export const logs = defineCall({
	name: "app.logs",
	summary: "An app's recent output, one line each.",
	who: PEOPLE,
	args: { name: Name, tail: opt(int()) },
	answer: arr(str()),
	effect: "read",
});

export const check = defineCall({
	name: "app.check",
	summary: "Open an app in the server's browser and say what is wrong, as card.fit does for a card.",
	who: PEOPLE,
	args: { name: Name },
	answer: AppCheck,
	effect: "read",
});
