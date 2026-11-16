import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { setAgentUiHost, type AgentUiHost } from "../composer/host.ts";
import type { StreamProps } from "../chat/stream/view.tsx";
import type { ComposerProps } from "../composer/bar/view.tsx";
import { AgentUi } from "./view.tsx";

// Mounting the chat and composer into an element of another page: the host first, then the parts.

/** What a page hands to mount them: the host, and each part's props. */
export interface AgentUiMount {
	host: AgentUiHost;
	stream: StreamProps;
	composer: ComposerProps;
}

/** Mount into an element; answers the function that takes them out again. */
export function mountAgentUi(element: HTMLElement, mount: AgentUiMount): () => void {
	setAgentUiHost(mount.host);
	return render(() => createComponent(AgentUi, { stream: mount.stream, composer: mount.composer }), element);
}
