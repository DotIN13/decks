import { createSignal } from "solid-js";
import type { PanelApp } from "../AppRow.tsx";

// The Apps tab's behaviour: which app row is picked, and whose logs are open.

export function createAppsTab() {
	const [picked, setPicked] = createSignal<string>();
	const [logsOf, setLogsOf] = createSignal<PanelApp>();
	return { picked, setPicked, logsOf, setLogsOf };
}
