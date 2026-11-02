import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { clockOf, filmLayout, SOUND_INK, soundLayout, waveBars } from "./media-look.ts";

/**
 * The one live player, laid over the film or sound it plays (`Stage.tsx` `playing`).
 *
 * It draws exactly what the still drew (`paint.ts` `paintMedia`), from the same layout, and adds
 * only what playing needs: the play button turns to pause, a sound's waveform fills as it plays
 * and can be pressed or dragged to seek, and a film gets a bar along its foot while the pointer is
 * on it or it is paused.
 *
 * **Presses on the picture are the canvas's.** The root lets them through, so a press on a film
 * or on a sound's name is still a press on a drawn item: a click plays or pauses it (the stage
 * asks `toggle`), and a drag moves it, as any item moves. Only the controls take presses.
 */
export interface MediaPlayerProps {
	kind: "video" | "audio";
	src: string;
	name: string;
	seconds?: number;
	peaks?: readonly number[];
	box: { x: number; y: number; w: number; h: number };
	radius: number;
	scheme: "light" | "dark";
	/** Where to start, when it was played before and stopped partway. */
	from?: number;
	/** The element, for the stage to play, pause and read. */
	ref: (element: HTMLMediaElement) => void;
	onEnded: () => void;
	/** Where it was when it stopped, so starting it again goes on from there. */
	onLeave: (at: number) => void;
}

const PLAY = "M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z";
const PAUSE = "M7 5h3.2v14H7zM13.8 5H17v14h-3.2z";

function Glyph(props: { paused: boolean }) {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d={props.paused ? PLAY : PAUSE} />
		</svg>
	);
}

export default function MediaPlayer(props: MediaPlayerProps) {
	let element!: HTMLMediaElement;
	let root!: HTMLDivElement;
	// Playing from the start: it is mounted because it was pressed, and says so if the browser refuses.
	const [paused, setPaused] = createSignal(false);
	const [at, setAt] = createSignal(props.from ?? 0);
	const [length, setLength] = createSignal(props.seconds ?? 0);
	const [muted, setMuted] = createSignal(false);
	// The film's bar shows while the pointer is over the film, and for a moment after it leaves.
	const [near, setNear] = createSignal(true);

	// The item's own box, at its corner: the player is placed there, and draws inside it.
	const place = () => ({ x: 0, y: 0, w: props.box.w, h: props.box.h });
	const progress = () => (length() > 0 ? Math.min(1, at() / length()) : 0);

	const toggle = (event: Event) => {
		event.stopPropagation();
		if (element.paused) void element.play().catch(() => {});
		else element.pause();
	};
	const hold = (event: PointerEvent) => event.stopPropagation();

	/** A press or a drag along a track: seek to where it is, for as long as it is held. */
	const scrub = (event: PointerEvent) => {
		event.stopPropagation();
		event.preventDefault();
		const track = event.currentTarget as HTMLElement;
		track.setPointerCapture(event.pointerId);
		const seek = (e: PointerEvent) => {
			const rect = track.getBoundingClientRect();
			const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
			if (length() > 0) {
				element.currentTime = fraction * length();
				setAt(element.currentTime);
			}
		};
		seek(event);
		const up = () => {
			track.removeEventListener("pointermove", seek);
			track.removeEventListener("pointerup", up);
			track.removeEventListener("pointercancel", up);
		};
		track.addEventListener("pointermove", seek);
		track.addEventListener("pointerup", up);
		track.addEventListener("pointercancel", up);
	};

	onMount(() => {
		if (props.from) element.currentTime = props.from;
		props.ref(element);
		void element.play().catch(() => setPaused(true));
		if (props.kind !== "video") return;
		// Near or not, from the pointer's place: the root lets presses through, so it cannot be hovered.
		let quiet: ReturnType<typeof setTimeout> | undefined;
		let frame: number | undefined;
		let last: { x: number; y: number } | undefined;
		const check = () => {
			frame = undefined;
			if (!last) return;
			const rect = root.getBoundingClientRect();
			const inside = last.x >= rect.left && last.x <= rect.right && last.y >= rect.top && last.y <= rect.bottom;
			if (!inside) return;
			setNear(true);
			clearTimeout(quiet);
			quiet = setTimeout(() => setNear(false), 2200);
		};
		const moved = (event: PointerEvent) => {
			last = { x: event.clientX, y: event.clientY };
			frame ??= requestAnimationFrame(check);
		};
		quiet = setTimeout(() => setNear(false), 2200);
		window.addEventListener("pointermove", moved, { passive: true });
		window.addEventListener("pointerdown", moved, { passive: true });
		onCleanup(() => {
			window.removeEventListener("pointermove", moved);
			window.removeEventListener("pointerdown", moved);
			clearTimeout(quiet);
			if (frame !== undefined) cancelAnimationFrame(frame);
		});
	});
	onCleanup(() => {
		props.onLeave(element.currentTime);
		element.pause();
		element.removeAttribute("src");
		element.load();
	});

	const wire = (el: HTMLMediaElement) => {
		element = el;
		el.addEventListener("play", () => setPaused(false));
		el.addEventListener("pause", () => setPaused(true));
		el.addEventListener("timeupdate", () => setAt(el.currentTime));
		el.addEventListener("durationchange", () => Number.isFinite(el.duration) && setLength(el.duration));
		el.addEventListener("volumechange", () => setMuted(el.muted));
		el.addEventListener("ended", () => props.onEnded());
	};

	const clock = () => (paused() && at() === 0 ? clockOf(Math.round(length())) : `${clockOf(at())} / ${clockOf(Math.round(length()))}`);

	if (props.kind === "audio") {
		const look = () => soundLayout(place());
		const ink = () => SOUND_INK[props.scheme];
		const bars = () => waveBars(look().wave, props.peaks);
		return (
			<div
				ref={root}
				class="pen-player"
				data-kind="audio"
				style={{
					left: `${props.box.x}px`,
					top: `${props.box.y}px`,
					width: `${props.box.w}px`,
					height: `${props.box.h}px`,
					"border-radius": `${props.radius}px`,
					background: ink().paper,
					color: ink().fg,
				}}
			>
				<audio ref={wire} src={props.src} preload="auto" />
				<button
					class="pen-player-disc"
					aria-label={paused() ? "Play" : "Pause"}
					style={{ left: `${look().disc.cx - look().disc.r}px`, top: `${look().disc.cy - look().disc.r}px`, width: `${look().disc.r * 2}px`, height: `${look().disc.r * 2}px`, background: ink().disc, color: ink().glyph }}
					onPointerDown={hold}
					onClick={toggle}
				>
					<Glyph paused={paused()} />
				</button>
				<div class="pen-player-name" style={{ left: `${look().name.x}px`, top: `${look().name.y}px`, width: `${look().name.w}px`, "font-size": `${look().name.size}px` }}>
					{props.name}
				</div>
				<div class="pen-player-time" style={{ right: `${props.box.w - look().time.right}px`, top: `${look().time.y}px`, "font-size": `${look().time.size}px`, color: ink().muted }}>
					{clock()}
				</div>
				<div
					class="pen-player-wave"
					role="slider"
					aria-label="Seek"
					aria-valuemin={0}
					aria-valuemax={Math.round(length())}
					aria-valuenow={Math.round(at())}
					style={{ left: `${look().wave.x}px`, top: `${look().wave.y}px`, width: `${look().wave.w}px`, height: `${look().wave.h}px` }}
					onPointerDown={scrub}
				>
					<Show
						when={bars().length}
						fallback={
							<>
								<i style={{ left: "0", top: `${look().wave.h / 2 - Math.max(2, 3 * look().k) / 2}px`, width: "100%", height: `${Math.max(2, 3 * look().k)}px`, background: ink().bar }} />
								<i style={{ left: "0", top: `${look().wave.h / 2 - Math.max(2, 3 * look().k) / 2}px`, width: `${progress() * 100}%`, height: `${Math.max(2, 3 * look().k)}px`, background: ink().played }} />
							</>
						}
					>
						<For each={bars()}>
							{(bar) => (
								<i
									style={{
										left: `${bar.x - look().wave.x}px`,
										top: `${bar.y - look().wave.y}px`,
										width: `${bar.w}px`,
										height: `${bar.h}px`,
										background: bar.at <= progress() ? ink().played : ink().bar,
									}}
								/>
							)}
						</For>
					</Show>
				</div>
			</div>
		);
	}

	const look = () => filmLayout(place());
	const unit = Math.min(1.6, Math.max(0.75, Math.min(props.box.w, props.box.h) / 300));
	return (
		<div
			ref={root}
			class="pen-player"
			data-kind="video"
			data-paused={paused() ? "" : undefined}
			data-near={near() ? "" : undefined}
			style={{
				left: `${props.box.x}px`,
				top: `${props.box.y}px`,
				width: `${props.box.w}px`,
				height: `${props.box.h}px`,
				"border-radius": `${props.radius}px`,
				"--u": String(unit),
			}}
		>
			<video ref={wire} src={props.src} playsinline preload="auto" />
			<button
				class="pen-player-big"
				aria-label="Play"
				style={{ left: `${look().disc.cx - look().disc.r}px`, top: `${look().disc.cy - look().disc.r}px`, width: `${look().disc.r * 2}px`, height: `${look().disc.r * 2}px` }}
				onPointerDown={hold}
				onClick={toggle}
			>
				<Glyph paused />
			</button>
			<div class="pen-player-bar" onPointerDown={hold}>
				<button aria-label={paused() ? "Play" : "Pause"} onClick={toggle}>
					<Glyph paused={paused()} />
				</button>
				<span class="pen-player-clock">{clock()}</span>
				<div class="pen-player-track" role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(length())} aria-valuenow={Math.round(at())} onPointerDown={scrub}>
					<i style={{ width: `${progress() * 100}%` }} />
				</div>
				<button
					aria-label={muted() ? "Sound on" : "Mute"}
					onClick={(event) => {
						event.stopPropagation();
						element.muted = !element.muted;
					}}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" />
						{muted() ? <path d="m22 9-6 6M16 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
					</svg>
				</button>
				<button
					aria-label="Full screen"
					onClick={(event) => {
						event.stopPropagation();
						const video = element as HTMLVideoElement;
						video.controls = true;
						const back = () => {
							if (document.fullscreenElement) return;
							video.controls = false;
							document.removeEventListener("fullscreenchange", back);
						};
						document.addEventListener("fullscreenchange", back);
						void video.requestFullscreen?.().catch(() => (video.controls = false));
					}}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
					</svg>
				</button>
			</div>
		</div>
	);
}
