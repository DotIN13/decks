/* @refresh reload */
// First, before anything else runs: the tab's person token is read and its tag taken out of the page.
import "../perf/probe-relay.ts";
import "../lib/session.ts";
import { App } from "../App.tsx";
import { active, PUBLIC } from "../connections/connection.ts";
import { Start } from "../connections/Start.tsx";
import { remount, setMount } from "../connections/switch.ts";
import "../index.css";
import { m, markDocumentLanguage } from "@decks/i18n";

// The language the page speaks (Settings, General, else the browser's), on <html lang> for fonts and screen readers.
markDocumentLanguage();

const root = document.getElementById("root");
if (!root) throw new Error("No #root to render into");

/*
 * The backend first (`connections/`): a tab on another server or on a canvas file needs its way
 * there ready (the service worker, or this server relaying) before the app asks for anything under
 * `/c/`. On this server's own page there is nothing to wait for, and the app starts exactly as it
 * always has. A switch later mounts the same way again, without loading the page (`switch.ts`).
 */
setMount(root, (failed) => {
	if (failed) return <Start why={failed} />;
	if (!active()) return <Start why={PUBLIC ? m.connections_start_public() : m.connections_start_forgotten()} />;
	return <App />;
});
void remount();
