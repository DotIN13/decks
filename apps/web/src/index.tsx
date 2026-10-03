/* @refresh reload */
import { App } from "./App.tsx";
import { active, PUBLIC } from "./connections/connection.ts";
import { Start } from "./connections/Start.tsx";
import { remount, setMount } from "./connections/switch.ts";
import "./index.css";

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
	if (!active()) return <Start why={PUBLIC ? "Open a canvas file someone sent you, or connect to a Decks server you can reach." : "This address names a connection this browser does not have any more."} />;
	return <App />;
});
void remount();
