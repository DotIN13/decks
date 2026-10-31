/**
 * A board that is an app (`apps/service.ts` on the server): a bar over a frame of `/app/<name>/`.
 *
 * The bar says what the app is doing — building, running, asleep, broken — reads the server's
 * `/api/apps/<name>` every couple of seconds while the board is drawn and seldom when it is not,
 * and holds Reload, Restart (a server app), Open in a tab, and the log.
 *
 * Seen is said with a heartbeat that only beats while this page is being painted: frames come
 * only to a page on screen, so a board panned away or asleep under its picture lets a server app
 * go to sleep after its idle minutes, and the next request from the frame wakes it again.
 *
 * In the server's own browser (pictures, `navigator.webdriver`) a server app is not loaded, so
 * taking a board's picture never starts a process.
 */

const STYLE = `
.live.app { display: flex; flex-direction: column; background: var(--b-bg); overflow: hidden; }
.app-bar { flex: none; display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; border-bottom: 1px solid var(--b-border); font: 500 14px/1 var(--b-font); color: var(--b-fg); }
.app-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--b-faint); flex: none; }
.app-state { font-weight: 600; }
.app-name { color: var(--b-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.app-kind { font-size: 14px; color: var(--b-muted); border: 1px solid var(--b-border); border-radius: 6px; padding: 2px 6px; }
.app-warn { color: var(--b-warn); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.app-warn[hidden] { display: none; }
.app-grow { flex: 1; }
.app-bar button, .app-bar a { font: 500 14px/1 var(--b-font); color: var(--b-fg); background: var(--b-bg); border: 1px solid var(--b-border); border-radius: 6px; padding: 5px 9px; cursor: pointer; text-decoration: none; }
.app-bar button[aria-pressed="true"] { background: var(--b-bg-deep); }
.app-body { position: relative; flex: 1; min-height: 0; }
.app-body iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; }
.app-cover { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 10px; padding: 20px 22px; background: var(--b-bg); overflow: hidden; }
.app-cover[hidden], .app-log[hidden] { display: none; }
.app-cover b { font: 600 17px/1.3 var(--b-font); color: var(--b-fg); }
.app-cover p { margin: 0; font: 15px/1.45 var(--b-font); color: var(--b-muted); }
.app-lines { margin: 0; flex: 1; min-height: 0; overflow: auto; font: 14px/1.55 var(--b-mono); color: var(--b-muted); white-space: pre-wrap; }
.app-lines .err { color: var(--b-danger); }
.app-log { position: absolute; left: 0; right: 0; bottom: 0; height: 40%; border-top: 1px solid var(--b-border); background: var(--b-bg-layer); padding: 8px 12px; display: flex; }
`;

const COLOURS = { running: "var(--b-ok)", installing: "var(--b-warn)", building: "var(--b-warn)", starting: "var(--b-warn)", asleep: "var(--b-accent)", broken: "var(--b-danger)", stopped: "var(--b-faint)" };
const WORDS = { running: "Running", installing: "Installing", building: "Building", starting: "Starting", asleep: "Asleep", broken: "Broken", stopped: "Stopped" };
const BUSY = new Set(["installing", "building", "starting"]);

export function mountLiveApp(host, options) {
	const name = host.dataset.app ?? "";
	const api = options.api;
	const base = api.replace(/\/api$/, "");
	const appUrl = `${base}/app/${name}/`;
	const robot = navigator.webdriver === true;

	if (!document.getElementById("live-app-style")) {
		const style = document.createElement("style");
		style.id = "live-app-style";
		style.textContent = STYLE;
		document.head.append(style);
	}
	host.textContent = "";
	host.classList.add("app");

	const el = (tag, cls, text) => {
		const node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text !== undefined) node.textContent = text;
		return node;
	};
	const bar = el("div", "app-bar");
	const dot = el("span", "app-dot");
	const state = el("span", "app-state", "…");
	const label = el("span", "app-name", `apps/${name}`);
	const kind = el("span", "app-kind", "");
	// What the server says the person should know, such as an app listening beyond this Mac (`warning`).
	const warn = el("span", "app-warn", "");
	warn.hidden = true;
	const reload = el("button", "", "Reload");
	reload.title = "Load the app again";
	const restart = el("button", "", "Restart");
	restart.title = "Stop the app's server and start it again";
	restart.hidden = true;
	const open = el("a", "", "Open");
	open.href = appUrl;
	open.target = "_blank";
	open.rel = "noopener";
	open.title = "Open the app in a tab of its own";
	const logs = el("button", "", "Log");
	logs.setAttribute("aria-pressed", "false");
	bar.append(dot, state, label, kind, warn, el("span", "app-grow"), reload, restart, open, logs);

	const body = el("div", "app-body");
	const frame = document.createElement("iframe");
	frame.title = name;
	const cover = el("div", "app-cover");
	const coverTitle = el("b");
	const coverText = el("p");
	const coverLines = el("pre", "app-lines");
	cover.append(coverTitle, coverText, coverLines);
	const drawer = el("div", "app-log");
	drawer.hidden = true;
	const drawerLines = el("pre", "app-lines");
	drawer.append(drawerLines);
	body.append(frame, cover, drawer);
	host.append(bar, body);

	/*
	 * Pan and zoom pass through the app. The canvas pans and zooms from wheel events it reads in
	 * the board's page (`frame-gestures.ts`), and the app is a page inside that one, so its wheel
	 * stopped there and the canvas never moved over an app. It is served from Decks' own address,
	 * so its page can be listened in from here, with the rule an embed keeps: a pinch (or ⌘ and
	 * the wheel) always zooms the canvas, a scroll a box in the app can still take is the app's,
	 * and the rest pans the canvas — sent on as a wheel over this frame, which the canvas reads.
	 */
	const canScroll = (view, element, dx, dy) => {
		const style = view.getComputedStyle(element);
		const root = element === (element.ownerDocument.scrollingElement ?? element.ownerDocument.documentElement);
		const scrolls = (overflow) => /auto|scroll/.test(overflow) || (root && overflow !== "hidden" && overflow !== "clip");
		if (scrolls(style.overflowY) && element.scrollHeight > element.clientHeight + 1 && Math.abs(dy) >= Math.abs(dx)) {
			if ((dy > 0 ? element.scrollHeight - element.clientHeight - element.scrollTop : element.scrollTop) > 1) return true;
		}
		if (scrolls(style.overflowX) && element.scrollWidth > element.clientWidth + 1 && Math.abs(dx) > Math.abs(dy)) {
			if ((dx > 0 ? element.scrollWidth - element.clientWidth - element.scrollLeft : element.scrollLeft) > 1) return true;
		}
		return false;
	};
	const scrollableUnder = (view, target, dx, dy) => {
		const doc = view.document;
		for (let node = target instanceof view.Element ? target : null; node; node = node.parentElement) if (canScroll(view, node, dx, dy)) return node;
		const root = doc.scrollingElement ?? doc.documentElement;
		return root && canScroll(view, root, dx, dy) ? root : undefined;
	};
	// The canvas's zoom, which the board's gestures say (`frame-gestures.ts`): a wheel's pixels are the screen's.
	const scale = () => (typeof window.decksScale === "function" ? Number(window.decksScale()) || 1 : 1);
	const passThrough = () => {
		let view;
		try {
			view = frame.contentWindow;
			if (!view?.document || view.__decksPassThrough) return;
			view.__decksPassThrough = true;
		} catch {
			return; // a page from another address, which keeps its own wheel
		}
		view.addEventListener(
			"wheel",
			(event) => {
				const zooming = event.ctrlKey || event.metaKey;
				event.preventDefault();
				/*
				 * A box in the app that can take the scroll is scrolled here, by hand, as the canvas does for
				 * boxes in a board: inside a frame the canvas has scaled, the browser's own scroll is not reliable.
				 */
				const box = zooming ? undefined : scrollableUnder(view, event.target, event.deltaX, event.deltaY);
				if (box) {
					box.scrollLeft += event.deltaX / scale();
					box.scrollTop += event.deltaY / scale();
					return;
				}
				const rect = frame.getBoundingClientRect();
				frame.dispatchEvent(
					new WheelEvent("wheel", {
						deltaX: event.deltaX,
						deltaY: event.deltaY,
						deltaMode: event.deltaMode,
						clientX: rect.left + event.clientX,
						clientY: rect.top + event.clientY,
						ctrlKey: zooming,
						bubbles: true,
						cancelable: true,
					}),
				);
			},
			{ passive: false, capture: true },
		);
		/*
		 * Fingers. One finger is the app's: a tap, a drag, its own scroll. A second finger makes it a
		 * pinch, and from then both are the canvas's, sent as the fingers an embed sends
		 * (`decks:embed-finger`, read by `frame-gestures.ts`) until they are lifted.
		 */
		const style = view.document.createElement("style");
		style.textContent = "html { touch-action: pan-x pan-y; }";
		(view.document.head ?? view.document.documentElement).append(style);
		const down = new Map();
		let canvasFingers = false;
		const finger = (phase, event) => {
			const rect = frame.getBoundingClientRect();
			frame.dispatchEvent(new CustomEvent("decks:embed-finger", { bubbles: true, detail: { phase, id: 800000 + event.pointerId, x: rect.left + event.clientX, y: rect.top + event.clientY } }));
		};
		const fingerDown = (event) => {
			if (event.pointerType !== "touch") return;
			down.set(event.pointerId, event);
			if (down.size < 2) return;
			event.preventDefault();
			event.stopPropagation();
			if (!canvasFingers) {
				canvasFingers = true;
				for (const one of down.values()) finger("down", one);
			} else finger("down", event);
		};
		const fingerMove = (event) => {
			if (event.pointerType !== "touch" || !down.has(event.pointerId)) return;
			down.set(event.pointerId, event);
			if (!canvasFingers) return;
			event.preventDefault();
			event.stopPropagation();
			finger("move", event);
		};
		const fingerUp = (event) => {
			if (event.pointerType !== "touch" || !down.delete(event.pointerId)) return;
			if (!canvasFingers) return;
			event.preventDefault();
			event.stopPropagation();
			finger("up", event);
			if (down.size === 0) canvasFingers = false;
		};
		/*
		 * A middle-drag, or a drag with Space held, pans the canvas wherever it starts, as over a board
		 * or an embed (`embed-guest.js`): handed on as the pan an embed sends (`decks:embed-pan`), in
		 * screen pixels, since the canvas moves the app under a still mouse. Space typed into a field
		 * is the field's.
		 */
		const doc = view.document;
		let space = false;
		const typing = (target) => target instanceof view.Element && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
		const spaceKey = (held) => document.dispatchEvent(new KeyboardEvent(held ? "keydown" : "keyup", { code: "Space", key: " ", bubbles: true, cancelable: true }));
		doc.addEventListener(
			"keydown",
			(event) => {
				if (event.code !== "Space" || typing(event.target)) return;
				event.preventDefault();
				if (space) return;
				space = true;
				spaceKey(true);
			},
			true,
		);
		const spaceUp = () => {
			if (!space) return;
			space = false;
			spaceKey(false);
		};
		doc.addEventListener("keyup", (event) => event.code === "Space" && spaceUp(), true);
		view.addEventListener("blur", spaceUp);
		const pan = (phase, event, button) => frame.dispatchEvent(new CustomEvent("decks:embed-pan", { bubbles: true, detail: { phase, sx: event.screenX, sy: event.screenY, button } }));
		doc.addEventListener(
			"pointerdown",
			(event) => {
				if (event.pointerType === "touch") return;
				if (!(event.button === 1 || (event.button === 0 && space))) return;
				event.preventDefault();
				event.stopPropagation();
				const button = event.button;
				doc.documentElement.style.cursor = "grabbing";
				pan("down", event, button);
				try {
					doc.documentElement.setPointerCapture(event.pointerId);
				} catch {
					/* the document's listeners carry the drag regardless */
				}
				// The button held, as `buttons` says it: a move without it is a release that never arrived.
				const held = button === 1 ? 4 : 1;
				let done = false;
				const up = (e) => {
					if (done) return;
					done = true;
					pan("up", e ?? event, button);
					doc.documentElement.style.removeProperty("cursor");
					doc.removeEventListener("pointermove", move, true);
					doc.removeEventListener("pointerup", up, true);
					doc.removeEventListener("pointercancel", up, true);
					view.removeEventListener("blur", lost);
					view.removeEventListener("pagehide", lost);
				};
				const lost = () => up(undefined);
				const move = (e) => ((e.buttons & held) === 0 ? up(e) : pan("move", e, button));
				doc.addEventListener("pointermove", move, true);
				doc.addEventListener("pointerup", up, true);
				doc.addEventListener("pointercancel", up, true);
				view.addEventListener("blur", lost);
				view.addEventListener("pagehide", lost);
			},
			true,
		);
		// No autoscroll and no paste from a middle press: it is the canvas's.
		doc.addEventListener("auxclick", (event) => event.button === 1 && event.preventDefault(), true);
		doc.addEventListener("mousedown", (event) => event.button === 1 && event.preventDefault(), true);
		view.addEventListener("pointerdown", fingerDown, { capture: true, passive: false });
		view.addEventListener("pointermove", fingerMove, { capture: true, passive: false });
		view.addEventListener("pointerup", fingerUp, { capture: true, passive: false });
		view.addEventListener("pointercancel", fingerUp, { capture: true, passive: false });
	};
	frame.addEventListener("load", passThrough);

	let current = undefined;
	let loaded = false;
	let wasBusy = false;
	let lastVersion = undefined;
	const load = () => {
		loaded = true;
		frame.src = `${appUrl}${appUrl.includes("?") ? "&" : "?"}_=${Date.now().toString(36)}`;
	};

	const lines = async (into) => {
		try {
			const answer = await fetch(`${api}/apps/${encodeURIComponent(name)}/log?tail=120`, { cache: "no-store" });
			const { lines: got = [] } = await answer.json();
			into.textContent = "";
			for (const line of got) {
				const row = el("span", /\berr(or)?\b|ERR!|failed|exception|exited with/i.test(line) ? "err" : "", `${line}\n`);
				into.append(row);
			}
			into.scrollTop = into.scrollHeight;
		} catch {
			into.textContent = "The log could not be read.";
		}
	};

	const draw = (app) => {
		current = app;
		dot.style.background = COLOURS[app.status] ?? "var(--b-faint)";
		state.textContent = WORDS[app.status] ?? app.status;
		label.textContent = app.title && app.title !== name ? `${app.title}` : `apps/${name}`;
		label.title = `apps/${name}, at ${appUrl}`;
		kind.textContent = app.kind === "server" ? "server app" : app.kind === "build" ? "built app" : "static app";
		restart.hidden = app.kind !== "server";
		warn.hidden = !app.warning;
		warn.textContent = app.warning ?? "";
		warn.title = app.warning ?? "";
		const busy = BUSY.has(app.status);
		const neverBuilt = app.kind === "build" && app.status === "stopped";
		let show = "";
		if (app.status === "broken") show = "broken";
		else if (busy && !loaded) show = "busy";
		else if (neverBuilt) show = "unbuilt";
		else if (robot && app.kind === "server") show = "picture";
		cover.hidden = show === "";
		if (show === "broken") {
			coverTitle.textContent = "The app stopped";
			coverText.textContent = app.error ? `${app.error}. Ask the agent that made it to look at the log, or press Restart.` : "Ask the agent that made it to look at the log, or press Restart.";
			void lines(coverLines);
		} else if (show === "busy") {
			coverTitle.textContent = `${WORDS[app.status]}…`;
			coverText.textContent = "The page shows here when it is ready.";
			void lines(coverLines);
		} else if (show === "unbuilt") {
			coverTitle.textContent = "Not built yet";
			coverText.textContent = `The agent builds it with stage.apps.build("${name}").`;
			coverLines.textContent = "";
		} else if (show === "picture") {
			coverTitle.textContent = app.title ?? name;
			coverText.textContent = "A server app; it starts when its board is opened.";
			coverLines.textContent = "";
		}
		// The page, once there is one to show; and again when a build, a restart or an edited file has made a new one.
		const changed = lastVersion !== undefined && app.version !== undefined && app.version !== lastVersion;
		if (show === "" && (!loaded || (wasBusy && !busy && app.status === "running") || (changed && app.status === "running"))) load();
		wasBusy = busy;
		if (app.version !== undefined) lastVersion = app.version;
		if (!drawer.hidden) void lines(drawerLines);
	};

	const ask = async () => {
		try {
			const answer = await fetch(`${api}/apps/${encodeURIComponent(name)}`, { cache: "no-store" });
			if (!answer.ok) {
				draw({ name, title: name, kind: "static", status: "broken", error: `there is no app called ${name}` });
				return;
			}
			draw(await answer.json());
		} catch {
			/* the server is away for a moment; the next ask comes round */
		}
	};

	reload.onclick = () => (cover.hidden ? load() : void ask());
	restart.onclick = async () => {
		restart.disabled = true;
		state.textContent = "Restarting";
		dot.style.background = COLOURS.starting;
		try {
			// A command, so asked of the page around this board, as a button's verb is (`board.js`, `boardStage`).
			const stage = await options.stage();
			await stage.apps.restart(name);
		} catch (error) {
			console.warn(`[decks] could not restart ${name}:`, error);
		} finally {
			restart.disabled = false;
			loaded = false;
			await ask();
		}
	};
	logs.onclick = () => {
		drawer.hidden = !drawer.hidden;
		logs.setAttribute("aria-pressed", String(!drawer.hidden));
		if (!drawer.hidden) void lines(drawerLines);
	};

	/*
	 * Painted means seen: a frame callback only runs for a page that is being drawn. Asked often
	 * while seen, seldom while not, and the heartbeat goes once a minute while seen.
	 */
	let paintedAt = performance.now();
	const tick = () => {
		paintedAt = performance.now();
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	const seenNow = () => performance.now() - paintedAt < 3000;
	let lastAsk = 0;
	setInterval(() => {
		const now = performance.now();
		const every = seenNow() ? (current && BUSY.has(current.status) ? 1500 : 4000) : 30_000;
		if (now - lastAsk >= every) {
			lastAsk = now;
			void ask();
		}
	}, 1000);
	setInterval(() => {
		// A read, not a post: a board's page gives no commands, and being looked at is not one.
		if (seenNow() && !robot) void fetch(`${api}/apps/${encodeURIComponent(name)}/seen`, { cache: "no-store" }).catch(() => {});
	}, 60_000);
	void ask();
}
