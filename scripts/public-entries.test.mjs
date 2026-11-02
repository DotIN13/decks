// The editor's packages promise only their public entry points: no package exports its internals, and no app imports them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const SHARED = ["canvas", "ui", "agent-ui"];

test("the shared editor packages export no internal paths", () => {
	for (const dir of SHARED) {
		const { exports } = JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8"));
		assert.deepEqual(Object.keys(exports).filter((key) => key.includes("internal")), [], `@decks/${dir}`);
	}
});

test("no app imports a shared package's files by path", () => {
	const deep = new RegExp(`["']@decks/(${SHARED.join("|")})/(internal|src)/`);
	const found = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			if (name === "node_modules" || name === "dist") continue;
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(ts|tsx|mjs|js)$/.test(name) && deep.test(readFileSync(path, "utf8"))) found.push(path.slice(root.length));
		}
	};
	walk(join(root, "apps"));
	assert.deepEqual(found, []);
});

/*
 * What Decks Studio imports from these packages (its `cards` branch, read 2026-11-02; the list is
 * `docs/REORGANIZATION.md`, Appendix A). Studio is matched to this tree after it is reorganized, so
 * until then a move or a rename in here must keep every one of these names resolving, and this is
 * what says so without a Studio checkout at hand. When Studio is matched, read its imports again
 * and bring the list up to date.
 */
const STUDIO_IMPORTS = {
	"@decks/canvas": ["bootFrame", "createFramedEditor", "fitAll", "canvasHost", "setCanvasHost", "CanvasHandle", "FrameChrome", "FramedHandle", "PenEdit", "PenTool", "StageComment"],
	"@decks/canvas/host": ["PenBar", "InkBar"],
	"@decks/canvas/camera": ["fitInto", "insets", "keepVisible", "useInsets"],
	"@decks/canvas/tools": ["drawing", "setDrawing", "penTool", "setPenTool", "setHandTool", "setInkTool", "setInsertPanel", "penBoxes", "penSelection", "fileCard", "InkTool", "PenTool"],
	"@decks/canvas/comments": ["withComments", "CardComment"],
	"@decks/agent-ui/chat": ["Stream", "receiveToolResult", "setToolResultSender"],
	"@decks/agent-ui/composer": ["DraftField", "commentLabel", "draftComments", "draftForAgent", "draftIsEmpty", "draftText", "parseDraft", "shortLabel", "textDraft", "Draft", "DraftFieldApi", "DraftMention"],
	"@decks/agent-ui/alerts": ["ALERT_KINDS", "ALERT_LABELS", "SILENT", "SOUND_IDS", "availability", "createAlerts", "createTabBadge", "finished", "play", "request", "soundName", "startedAsking", "AlertPrefs"],
	"@decks/ui": ["onDismiss"],
	"@decks/ui/float": ["makeFloat"],
	"@decks/card-host": ["LIVE_CARD_HEADERS", "cardModuleOf", "cardModules", "contentType", "libFile", "passes", "unstampCard"],
	"@decks/hub": ["Live", "NotConnected", "changesSince", "commitEdits", "mayEdit", "merge", "syncHandler", "HubStore"],
	"@decks/hub/node": ["nodeHandler"],
	"@decks/hub/follower": ["CanvasFollower"],
	"@decks/sync-client": ["HarnessSync"],
	"@decks/sync-protocol": ["CANVAS_NAME", "safeSyncPath", "Changes", "HarnessApp", "Inventory", "LiveEvent", "LiveSend", "PenEdit", "Role", "SyncCanvas", "SyncFile"],
	"@decks/pen": ["applyEdits", "baseTheme", "boxOf", "diff", "emptyDocument", "idFor", "ids", "parse", "placements", "read", "serialize", "Op", "PenDocument", "PenEdit"],
	"@decks/protocol": ["THINKING_LEVELS", "AgentKind", "AgentMode", "AgentState", "ChatItem", "ModelOption", "SlashCommand", "ThinkingLevel"],
	"@decks/sdk": ["connect", "DecksError", "Decks"],
};

/** The file a specifier resolves to through its package's `exports` map (the `types` or `default` of a conditional one). */
function entryFile(specifier) {
	const [, pkg, ...rest] = specifier.split("/");
	const sub = rest.length ? `./${rest.join("/")}` : ".";
	const manifest = JSON.parse(readFileSync(join(root, "packages", pkg, "package.json"), "utf8"));
	let target = manifest.exports?.[sub];
	if (target && typeof target === "object") target = target.types ?? target.default;
	assert.ok(target, `${specifier} is not in @decks/${pkg}'s exports`);
	return join(root, "packages", pkg, target);
}

/** Every name a module exports, following `export * from "./…"` one level down. */
function exportedNames(file, depth = 0) {
	const text = readFileSync(file, "utf8");
	const names = new Set();
	for (const m of text.matchAll(/export\s+(?:async\s+)?(?:declare\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
	for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) for (const part of m[1].split(",")) { const name = part.replace(/\btype\b/g, "").trim().split(/\s+as\s+/).pop().trim(); if (name) names.add(name); }
	if (depth < 2) for (const m of text.matchAll(/export\s+\*\s+from\s+"(\.[^"]+)"/g)) for (const name of exportedNames(join(file, "..", m[1]), depth + 1)) names.add(name);
	return names;
}

test("every name Decks Studio imports from the packages resolves", () => {
	const missing = [];
	for (const [specifier, wanted] of Object.entries(STUDIO_IMPORTS)) {
		const names = exportedNames(entryFile(specifier));
		for (const name of wanted) if (!names.has(name)) missing.push(`${name} from ${specifier}`);
	}
	assert.deepEqual(missing, []);
});
