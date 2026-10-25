import ArrowUp from "lucide-solid/icons/arrow-up";
import Sparkles from "lucide-solid/icons/sparkles";
import { For, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "../ui/icons.tsx";

/** What a sketch is most often asked: one press each. */
const ASKS = ["What is this?", "Clean it up", "Make it a diagram", "Turn it into a list"];

/**
 * Ask the agent about the ink selected (the pill's Ask, `BoardCallout`'s `ink`): one line, under the pill,
 * with the questions a sketch is most often asked. Enter or the arrow sends it; Escape or a press
 * elsewhere closes it.
 */
export function InkAsk(props: { agent: string; count: number; anchor: DOMRect; onAsk: (question: string) => void; onClose: () => void }) {
	let field: HTMLInputElement | undefined;
	let box: HTMLDivElement | undefined;
	const send = (question: string) => {
		const text = question.trim();
		if (!text) return;
		props.onAsk(text);
		props.onClose();
	};
	onMount(() => {
		requestAnimationFrame(() => field?.focus());
		const away = (event: PointerEvent) => {
			if (!box?.contains(event.target as Node)) props.onClose();
		};
		const keys = (event: KeyboardEvent) => {
			if (event.key === "Escape") props.onClose();
		};
		window.addEventListener("pointerdown", away, true);
		window.addEventListener("keydown", keys);
		onCleanup(() => {
			window.removeEventListener("pointerdown", away, true);
			window.removeEventListener("keydown", keys);
		});
	});
	// Under the pill, its middle on the pill's, kept on the screen.
	const width = Math.min(380, window.innerWidth - 16);
	const left = Math.min(Math.max(8, props.anchor.left + props.anchor.width / 2 - width / 2), window.innerWidth - width - 8);
	const top = Math.min(props.anchor.bottom + 8, window.innerHeight - 120);
	return (
		<Portal>
			<div ref={box} class="ink-ask" role="dialog" aria-label={`Ask ${props.agent} about these strokes`} style={{ left: `${left}px`, top: `${top}px`, width: `${width}px` }}>
				<label class="ink-ask-row">
					<Icon of={Sparkles} size={15} />
					<input
						ref={field}
						type="text"
						placeholder={`Ask ${props.agent} about ${props.count === 1 ? "this stroke" : `these ${props.count} strokes`}…`}
						onKeyDown={(event) => {
							if (event.key === "Enter") send(event.currentTarget.value);
						}}
					/>
					<button type="button" class="ink-ask-go" aria-label="Ask" onClick={() => send(field?.value ?? "")}>
						<Icon of={ArrowUp} size={15} />
					</button>
				</label>
				<div class="ink-ask-suggest">
					<For each={ASKS}>{(ask) => <button type="button" onClick={() => send(ask)}>{ask}</button>}</For>
				</div>
			</div>
		</Portal>
	);
}
