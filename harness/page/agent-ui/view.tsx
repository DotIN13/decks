import { Stream, type StreamProps } from "../chat/stream/view.tsx";
import { Composer, type ComposerProps } from "../composer/bar/view.tsx";
import "./styles.css";

// The conversation above the composer, as one thing to mount; a page that lays them out itself
// mounts Stream and Composer apart instead.

/** The chat and the composer together, each with the props it takes on its own. */
export function AgentUi(props: { stream: StreamProps; composer: ComposerProps }) {
	return (
		<div class="agent-ui">
			<Stream {...props.stream} />
			<div class="dock">
				<Composer {...props.composer} />
			</div>
		</div>
	);
}
