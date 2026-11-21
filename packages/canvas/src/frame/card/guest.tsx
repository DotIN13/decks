import { life, sayShared } from "@decks/frame";
import { formatNumber, m } from "@decks/i18n";
import { dismissMenus } from "@decks/ui";
import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { setCanvasHost } from "../../base/host.ts";
import { setCanvasScheme } from "../../base/theme.ts";
import { giveDeckImports } from "../../items/card.ts";
import { CardSurface } from "../../items/card-surface.tsx";
import { createBackend } from "../inside/backend.ts";
import { cardCalls } from "../inside/card-calls.ts";
import type { CardEnd, CardStart } from "./protocol.ts";

/** The room round the card in its tab, and the height it has before its content has said its own. */
const MARGIN = 28;
const FIRST_HEIGHT = 480;

/**
 * Run one card in the frame, whole: the card's own surface (`items/card-surface.tsx`), as on a canvas,
 * at its own width in the middle of the window, or fitted to the window's when that is the narrower,
 * as tall as its content, the window scrolling when it is taller. Its calls take the roads they take on a canvas (`inside/card-calls.ts`): the canvas's go
 * to the harness on the canvas's pass, the page's are asked of the page, and those that move a camera
 * have none to move. Answers how to stop it.
 */
export async function runCard(root: HTMLElement, start: CardStart, end: CardEnd): Promise<() => void> {
	const folder = `canvases/${start.canvas}/`;
	let filesBase = start.files.base;
	const backend = createBackend(start.backend.api, start.canvas, start.backend.token);
	end.on("token", (data) => {
		backend.setToken(data.token);
		if (data.files) filesBase = data.files.base;
	});
	const inFolder = (path: string) => (path.startsWith(folder) || path.startsWith("shared/") ? path : `${folder}${path}`);
	const address = (path: string) => `${filesBase}${path.split("/").map(encodeURIComponent).join("/")}`;
	if (start.imports) giveDeckImports(start.imports, new URL(folder, start.files.base).href);

	const look = (dark: boolean) => {
		document.documentElement.dataset.colorScheme = dark ? "dark" : "light";
		setCanvasScheme(dark ? "dark" : "light");
	};
	const [foot, setFoot] = createSignal(start.look.foot);
	look(start.look.dark);
	end.on("look", (data) => {
		look(data.dark);
		setFoot(data.foot);
	});
	sayShared(end as never, { dismiss: dismissMenus, signal: life() });

	const [card, setCard] = createSignal({ rev: start.card.rev, w: start.card.w });
	const [reloads, setReloads] = createSignal(0);
	const [height, setHeight] = createSignal(FIRST_HEIGHT);
	end.on("card", (data) => setCard(data));
	const viewport = () => ({ width: innerWidth, height: innerHeight });
	setCanvasHost({
		fileUrl: (path, rev) => `${address(inFolder(path))}${rev === undefined ? "" : `?rev=${rev}`}`,
		canWrite: () => true,
		openLink: (href) => end.emit("open-link", { href }),
		// A link to something in the deck is the page's to read and open, as a tab.
		openAddress: (address, browser) => end.emit("open-at", { address, ...(browser ? { browser: true as const } : {}) }),
		cardCall: cardCalls({
			canvas: start.canvas,
			camera: () => ({ x: 0, y: 0, zoom: 1 }),
			move: () => {},
			focus: () => {},
			viewport,
			reload: (path) => path === start.card.path && setReloads((n) => n + 1),
			harness: (verb, args) => backend.call(verb, args),
			page: (verb, args, from) => end.call("agent", { verb, args, card: from }),
		}),
	});

	/*
	 * A card wider than the window is fitted to its width, whole, as a page is on a phone: laid out at
	 * its own width and drawn smaller, so nothing of it is cut off at the window's edge. A button in the
	 * corner, there only while the card is the wider, shows it at its own size instead, where the
	 * window scrolls both ways.
	 */
	const [room, setRoom] = createSignal(innerWidth);
	const onResize = () => setRoom(innerWidth);
	addEventListener("resize", onResize);
	const [fitted, setFitted] = createSignal(true);
	const fits = () => Math.min(1, Math.max(0.1, (room() - 2 * MARGIN) / card().w));
	const scale = () => (fitted() ? fits() : 1);

	const dispose = render(
		() => (
			<div class="card-tab" data-scale={scale()} style={{ position: "absolute", inset: "0", overflow: "auto", background: "var(--canvas-bg)" }}>
				<div class="card-tab-card" style={{ position: "relative", width: `${card().w * scale()}px`, height: `${height() * scale()}px`, margin: `${MARGIN}px auto ${MARGIN + foot()}px`, "border-radius": "var(--canvas-item-corners, var(--canvas-card-radius, 12px))", overflow: "hidden", background: "var(--canvas-card-bg, var(--canvas-panel))", "box-shadow": "0 1px 3px rgb(0 0 0 / 12%), 0 8px 24px rgb(0 0 0 / 10%)" }}>
					<div style={{ position: "absolute", left: "0", top: "0", width: `${card().w}px`, height: `${height()}px`, transform: `scale(${scale()})`, "transform-origin": "0 0" }}>
						<CardSurface
							page={address(start.card.path)}
							path={start.card.path}
							trusted={start.card.trusted}
							rev={card().rev}
							reload={reloads()}
							size={() => ({ w: card().w, h: height() })}
							selected
							onSelect={() => {}}
							onShown={() => {}}
							onExtent={(extent) => setHeight(Math.max(120, Math.ceil(extent.h)))}
						/>
					</div>
				</div>
				<Show when={fits() < 1}>
					<button
						type="button"
						class="card-tab-fit"
						aria-pressed={fitted()}
						title={fitted() ? m.canvas_card_tab_actual() : m.canvas_card_tab_fit_title()}
						style={{ position: "fixed", top: "10px", right: "10px", "z-index": "5", height: "30px", padding: "0 10px", border: "1px solid var(--canvas-line, rgb(0 0 0 / 12%))", "border-radius": "9px", background: "var(--canvas-panel, #fff)", color: "var(--canvas-fg, #1f2328)", font: "500 12px var(--canvas-font-sans, system-ui)", cursor: "pointer", "box-shadow": "0 1px 3px rgb(0 0 0 / 12%)" }}
						onClick={() => setFitted((was) => !was)}
					>
						{fitted() ? formatNumber(fits(), { style: "percent", maximumFractionDigits: 0 }) : m.canvas_pill_fit()}
					</button>
				</Show>
			</div>
		),
		root,
	);
	return () => {
		removeEventListener("resize", onResize);
		dispose();
		end.close();
	};
}
