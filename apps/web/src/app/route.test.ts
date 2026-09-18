import assert from "node:assert/strict";
import { test } from "node:test";
import {
	TAB_KEY,
	formatPlace,
	installRoute,
	landing,
	parsePlace,
	samePlace,
	type Place,
	type RouteWindow,
} from "./route.ts";

function fakeStorage(initial: Record<string, string> = {}): Storage & { data: Record<string, string> } {
	const data: Record<string, string> = { ...initial };
	return {
		data,
		get length() {
			return Object.keys(data).length;
		},
		clear: () => {
			for (const k of Object.keys(data)) delete data[k];
		},
		getItem: (k) => (k in data ? (data[k] as string) : null),
		key: (i) => Object.keys(data)[i] ?? null,
		removeItem: (k) => {
			delete data[k];
		},
		setItem: (k, v) => {
			data[k] = String(v);
		},
	};
}

interface FakeWindow extends RouteWindow {
	pushes: string[];
	replaces: string[];
	listeners: Array<() => void>;
	back: (hash: string) => void;
}

function fakeWindow(hash: string): FakeWindow {
	const win: FakeWindow = {
		location: { hash },
		history: {
			pushState: (_data, _unused, url) => {
				win.pushes.push(String(url));
				win.location.hash = String(url);
			},
			replaceState: (_data, _unused, url) => {
				win.replaces.push(String(url));
				win.location.hash = String(url);
			},
		},
		pushes: [],
		replaces: [],
		listeners: [],
		addEventListener: (_type, listener) => {
			win.listeners.push(listener);
		},
		removeEventListener: (_type, listener) => {
			win.listeners = win.listeners.filter((l) => l !== listener);
		},
		back: (next) => {
			win.location.hash = next;
			for (const l of win.listeners) l();
		},
	};
	return win;
}

test("empty hashes and unknown paths parse to nothing", () => {
	assert.equal(parsePlace(""), undefined);
	assert.equal(parsePlace("#"), undefined);
	assert.equal(parsePlace("#/"), undefined);
	assert.equal(parsePlace("#/nope"), undefined);
	assert.equal(parsePlace("#boards"), undefined);
	assert.equal(parsePlace("#/boards/extra"), undefined);
	assert.equal(parsePlace("#/agent"), undefined);
	assert.equal(parsePlace("#/agent/"), undefined);
	assert.equal(parsePlace("#/agent/a/b"), undefined);
	assert.equal(parsePlace("#/agent/has space"), undefined);
	assert.equal(parsePlace("#/agent/dot.id"), undefined);
});

test("the three dispatch tabs, with or without the leading hash and a trailing slash", () => {
	assert.deepEqual(parsePlace("#/boards"), { surface: "dispatch", tab: "boards" });
	assert.deepEqual(parsePlace("#/tasks"), { surface: "dispatch", tab: "tasks" });
	assert.deepEqual(parsePlace("#/cron"), { surface: "dispatch", tab: "cron" });
	assert.deepEqual(parsePlace("/cron"), { surface: "dispatch", tab: "cron" });
	assert.deepEqual(parsePlace("#/boards/"), { surface: "dispatch", tab: "boards" });
});

test("a board is URI-decoded, and a bad or empty one is dropped rather than failing the tab", () => {
	assert.deepEqual(parsePlace("#/boards?board=risk%2Fmodel.html"), {
		surface: "dispatch",
		tab: "boards",
		board: "risk/model.html",
	});
	assert.deepEqual(parsePlace("#/boards?x=1&board=a%20b"), { surface: "dispatch", tab: "boards", board: "a b" });
	assert.deepEqual(parsePlace("#/boards?board=a+b"), { surface: "dispatch", tab: "boards", board: "a+b" });
	assert.deepEqual(parsePlace("#/boards?board="), { surface: "dispatch", tab: "boards" });
	assert.deepEqual(parsePlace("#/boards?board=%E0%A4%A"), { surface: "dispatch", tab: "boards" });
	assert.deepEqual(parsePlace("#/boards?other=1"), { surface: "dispatch", tab: "boards" });
});

test("an agent id is letters, digits, hyphens and underscores", () => {
	assert.deepEqual(parsePlace("#/agent/sable"), { surface: "stage", agent: "sable" });
	assert.deepEqual(parsePlace("#/agent/Ag_3-x"), { surface: "stage", agent: "Ag_3-x" });
});

test("format is the inverse of parse", () => {
	const places: Place[] = [
		{ surface: "dispatch", tab: "boards" },
		{ surface: "dispatch", tab: "tasks" },
		{ surface: "dispatch", tab: "cron" },
		{ surface: "dispatch", tab: "boards", board: "risk/model.html" },
		{ surface: "dispatch", tab: "boards", board: "a+b c&d=e#f?g" },
		{ surface: "stage", agent: "sable-2" },
	];
	for (const place of places) assert.deepEqual(parsePlace(formatPlace(place)), place);
	assert.equal(formatPlace({ surface: "dispatch", tab: "boards", board: "a b" }), "#/boards?board=a%20b");
	assert.equal(formatPlace({ surface: "dispatch", tab: "boards", board: "" }), "#/boards");
	assert.equal(formatPlace({ surface: "stage", agent: "x" }), "#/agent/x");
});

test("samePlace compares by value and treats a missing board as no board", () => {
	assert.equal(samePlace(undefined, undefined), true);
	assert.equal(samePlace(undefined, { surface: "dispatch", tab: "boards" }), false);
	assert.equal(samePlace({ surface: "dispatch", tab: "boards" }, { surface: "dispatch", tab: "boards" }), true);
	assert.equal(samePlace({ surface: "dispatch", tab: "boards" }, { surface: "dispatch", tab: "tasks" }), false);
	assert.equal(
		samePlace({ surface: "dispatch", tab: "boards", board: "a" }, { surface: "dispatch", tab: "boards" }),
		false,
	);
	assert.equal(
		samePlace({ surface: "dispatch", tab: "boards", board: "a" }, { surface: "dispatch", tab: "boards", board: "a" }),
		true,
	);
	assert.equal(samePlace({ surface: "stage", agent: "a" }, { surface: "stage", agent: "a" }), true);
	assert.equal(samePlace({ surface: "stage", agent: "a" }, { surface: "stage", agent: "b" }), false);
	assert.equal(samePlace({ surface: "stage", agent: "a" }, { surface: "dispatch", tab: "boards" }), false);
});

test("landing prefers the hash, then the remembered tab, then boards", () => {
	const storage = fakeStorage({ [TAB_KEY]: "cron" });
	assert.deepEqual(landing("#/agent/a", storage), { surface: "stage", agent: "a" });
	assert.deepEqual(landing("", storage), { surface: "dispatch", tab: "cron" });
	assert.deepEqual(landing("#/junk", storage), { surface: "dispatch", tab: "cron" });
	assert.deepEqual(landing("", fakeStorage({ [TAB_KEY]: "elsewhere" })), { surface: "dispatch", tab: "boards" });
	assert.deepEqual(landing("", fakeStorage()), { surface: "dispatch", tab: "boards" });
	const broken = {
		getItem: () => {
			throw new Error("refused");
		},
	};
	assert.deepEqual(landing("", broken), { surface: "dispatch", tab: "boards" });
});

test("installRoute reads the landing place once and writes it with replaceState when the hash was empty", () => {
	const win = fakeWindow("");
	const storage = fakeStorage({ [TAB_KEY]: "tasks" });
	const seen: Place[] = [];
	const route = installRoute({ onPlace: (p) => seen.push(p), storage, win });
	assert.deepEqual(seen, [{ surface: "dispatch", tab: "tasks" }]);
	assert.deepEqual(win.replaces, ["#/tasks"]);
	assert.deepEqual(win.pushes, []);
	assert.equal(win.listeners.length, 1);
	route.dispose();
	assert.equal(win.listeners.length, 0);
});

test("installRoute leaves a valid hash alone", () => {
	const win = fakeWindow("#/agent/sable");
	const seen: Place[] = [];
	installRoute({ onPlace: (p) => seen.push(p), storage: fakeStorage(), win });
	assert.deepEqual(seen, [{ surface: "stage", agent: "sable" }]);
	assert.deepEqual(win.replaces, []);
});

test("go pushes a new hash, remembers a dispatch tab, and does not push a hash it is already on", () => {
	const win = fakeWindow("#/boards");
	const storage = fakeStorage();
	const seen: Place[] = [];
	const route = installRoute({ onPlace: (p) => seen.push(p), storage, win });
	route.go({ surface: "stage", agent: "sable" });
	assert.deepEqual(win.pushes, ["#/agent/sable"]);
	assert.equal(storage.data[TAB_KEY], "boards");
	route.go({ surface: "dispatch", tab: "cron" });
	assert.deepEqual(win.pushes, ["#/agent/sable", "#/cron"]);
	assert.equal(storage.data[TAB_KEY], "cron");
	route.go({ surface: "dispatch", tab: "cron" });
	assert.deepEqual(win.pushes, ["#/agent/sable", "#/cron"]);
	assert.equal(seen.length, 4);
	route.go({ surface: "dispatch", tab: "boards", board: "a b" }, { replace: true });
	assert.deepEqual(win.replaces, ["#/boards?board=a%20b"]);
	assert.equal(win.location.hash, "#/boards?board=a%20b");
});

test("popstate reports the parsed place, falling back to the landing place", () => {
	const win = fakeWindow("#/boards");
	const storage = fakeStorage();
	const seen: Place[] = [];
	installRoute({ onPlace: (p) => seen.push(p), storage, win });
	win.back("#/agent/x");
	assert.deepEqual(seen.at(-1), { surface: "stage", agent: "x" });
	win.back("#/garbage");
	assert.deepEqual(seen.at(-1), { surface: "dispatch", tab: "boards" });
});

test("installRoute survives having no window at all", () => {
	const seen: Place[] = [];
	const route = installRoute({ onPlace: (p) => seen.push(p), storage: fakeStorage() });
	assert.deepEqual(seen, [{ surface: "dispatch", tab: "boards" }]);
	route.go({ surface: "stage", agent: "a" });
	assert.deepEqual(seen.at(-1), { surface: "stage", agent: "a" });
	route.dispose();
});

test("#/stage is the focused agent's stage, with no id yet, and formats back the same", () => {
	assert.deepEqual(parsePlace("#/stage"), { surface: "stage", agent: "" });
	assert.equal(formatPlace({ surface: "stage", agent: "" }), "#/stage");
	assert.equal(formatPlace({ surface: "stage", agent: "a1" }), "#/agent/a1");
});
