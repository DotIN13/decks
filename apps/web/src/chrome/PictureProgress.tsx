import Images from "lucide-solid/icons/images";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { api } from "../connections/connection.ts";
import { Icon } from "../ui/icons.tsx";

/** What `GET /api/pictures` answers (`PictureProgress` in the server's `boards/thumbs.ts`). */
interface Progress {
	total: number;
	ready: number;
	working: boolean;
	failed: number;
}

/** How often the row asks again while the menu is open. */
const EVERY_MS = 1000;

/**
 * How far the server has got keeping a picture of every board, at every size the canvas draws:
 * a row in the ⋯ menu. The server takes what is missing in the background (`ThumbService.index`);
 * this asks how far it has got each second, and only while the menu is open, since the menu's
 * contents exist only then.
 */
export function PictureProgress() {
	const [progress, setProgress] = createSignal<Progress | undefined>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	const ask = async () => {
		try {
			const answer = await fetch(api("/pictures"), { cache: "no-store" });
			if (answer.ok) setProgress((await answer.json()) as Progress);
		} catch {
			/* a server that does not answer leaves the row as it was */
		}
		if (!stopped) timer = setTimeout(() => void ask(), EVERY_MS);
	};
	onMount(() => void ask());
	onCleanup(() => {
		stopped = true;
		clearTimeout(timer);
	});
	const done = () => {
		const p = progress();
		return !!p && p.ready >= p.total && !p.working;
	};
	const share = () => {
		const p = progress();
		return p && p.total > 0 ? Math.min(100, (100 * p.ready) / p.total) : 0;
	};

	const count = (n: number) => n.toLocaleString("en-US");

	return (
		<div
			data-row
			data-flat="true"
			/* A reading: a press on it does not close the menu (`Popover`). */
			data-keep-open
			class="picture-progress"
			role="status"
			title={done() ? "Every board has its pictures at every size" : "Pictures of the boards are being made in the background"}
		>
			<span class="row-icon">
				<Icon of={Images} size={15} />
			</span>
			<span class="flex min-w-0 flex-1 flex-col gap-[4px]">
				<span class="row-label">Board pictures</span>
				<Show when={!done()}>
					<span class="picture-progress-track" aria-hidden="true">
						<span class="picture-progress-fill" style={{ width: `${share()}%` }} />
					</span>
					<span class="meta tabular-nums">
						{(() => {
							const p = progress();
							if (!p) return "Checking…";
							return `${count(p.ready)} of ${count(p.total)} made${p.failed > 0 ? `, ${count(p.failed)} failed` : ""}`;
						})()}
					</span>
				</Show>
			</span>
			<Show when={done()}>
				<span class="meta flex-none">All ready</span>
			</Show>
		</div>
	);
}
