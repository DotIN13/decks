/**
 * The one surface lifecycle: a card, an app and a document wake, sleep and take a press by one rule
 * (`items/awake.ts`). A small canvas of 3 cards, 3 apps and 1 document (`e2e/awake-canvas.mjs`), and:
 *
 * - below the live zoom (40%) no item of any kind has a node: each is its picture on the sheet;
 * - at 60% every item near the screen is awake within its kind's budget, and has a node;
 * - with three apps near and a budget of two, the two nearest the middle run; panned so the third is
 *   nearest, it takes a place and the farthest sleeps to its picture;
 * - a pinch mounts nothing mid-gesture: nodes come and go only at rest;
 * - a press in an app selects it first, and only then does its window take the pointer (the person's choice).
 */
import { API, asPerson, canvasFrame, deckState, nameOf, open, say, socket } from "../harness.mjs";
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();
import { writeAwakeCanvas } from "../awake-canvas.mjs";

const CANVAS = "awake-small";
const until = async (test, ms = 15000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await Promise.resolve().then(test).catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 120));
	}
};

/** A check that hangs says where: its phase, then it exits. */
let phase = "start";
const at = (name) => (phase = name);
setTimeout(() => {
	say(`the check finished within 90 s (hung in: ${phase})`, false);
	process.exit(1);
}, 90_000).unref();
const deck = await deckState();
const written = writeAwakeCanvas(deck.path, { cards: 3, apps: 3, documents: 1, name: CANVAS, prefix: "small" });
say("the small awake canvas is written", written.cards === 3 && written.apps === 3 && written.documents === 1, JSON.stringify(written));

const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
const { page, context, errors } = await open({ width: 1400, height: 900, cards: false });
/** Picture requests and their answers, for a failure to explain itself. */
const pictureLog = [];
page.on("response", (response) => {
	const url = response.url();
	if (/\/thumb\//.test(url)) pictureLog.push(`${response.status()} ${response.headers()["x-decks-picture"] ?? ""} ${decodeURIComponent(url.replace(/^.*\/thumb\//, "")).slice(0, 90)}`);
});
link.send({ type: "agent.stage", id: agentId, stage: CANVAS });
setTimeout(() => link.send({ type: "stage.pen.get", agentId }), 1000);
await until(() => link.received.some((m) => m.type === "stage.pen" && m.stage === CANVAS), 20000);
await page.reload({ waitUntil: "domcontentloaded" });
const canvas = await canvasFrame(page);
const seven = await canvas
	.waitForFunction(() => (globalThis.__decksCards?.().length ?? 0) >= 7, undefined, { timeout: 30000 })
	.then(() => true)
	.catch(() => false);
say("the stage shows the seven items", seven, String(await canvas.evaluate(() => globalThis.__decksCards?.().length)));
// A look at the placeholders, before their pictures come (`AWAKE_SHOTS=<folder>`).
const shots = process.env.AWAKE_SHOTS;
if (shots) await page.screenshot({ path: `${shots}/awake-opening.png` });

await canvas.evaluate(() => {
	const stage = () => document.querySelector(".stage");
	const raf = () => new Promise((done) => requestAnimationFrame(() => done()));
	const wheel = (deltaX, deltaY, ctrlKey) => {
		const r = stage().getBoundingClientRect();
		stage().dispatchEvent(new WheelEvent("wheel", { deltaX, deltaY, ctrlKey, deltaMode: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
	};
	globalThis.__t = {
		async zoomTo(zoom) {
			for (let i = 0; i < 200; i++) {
				const now = globalThis.__decksRust.camera.zoom;
				const ln = Math.log(zoom / now);
				if (Math.abs(ln) < 1e-6) return;
				wheel(0, -64 * Math.max(-Math.log(1.29), Math.min(Math.log(1.29), ln)), true);
				await raf();
			}
		},
		async panTo(x, y) {
			for (let i = 0; i < 40; i++) {
				const c = globalThis.__decksRust.camera;
				const dx = (x - c.x) * c.zoom;
				const dy = (y - c.y) * c.zoom;
				if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
				wheel(Math.max(-3000, Math.min(3000, dx)), Math.max(-3000, Math.min(3000, dy)), false);
				await raf();
				await raf();
			}
		},
		/** The stage at rest: which items have nodes, which windows show an app, how many documents are editors. */
		state() {
			const cards = globalThis.__decksCards?.() ?? [];
			return {
				nodes: cards.filter((c) => c.node).map((c) => c.path).sort(),
				// Apps whose window shows the app and whose node is live: a kept app keeps its window loaded, hidden under its picture.
				apps: [...document.querySelectorAll('.world .card-node[data-state="live"]')].filter((n) => n.querySelector(".app-surface[data-live]")).map((n) => n.dataset.path).sort(),
				kept: [...document.querySelectorAll('.world .card-node[data-state="kept"]')].map((n) => n.dataset.path).sort(),
				states: Object.fromEntries([...document.querySelectorAll(".world .card-node")].map((n) => [n.dataset.path, `${n.dataset.state}/${n.querySelector(".app-surface")?.dataset.live ?? "-"}/${n.querySelector(".app-surface-body p")?.textContent?.slice(0, 40) ?? ""}`])),
				documents: document.querySelectorAll(".world .document-surface").length,
				cardHosts: document.querySelectorAll(".world .card-host").length,
			};
		},
	};
});
/** Until the camera is still and nothing on the stage has changed for `ms`. */
const rest = (ms = 900, cap = 12000) =>
	canvas.evaluate(
		async ({ ms, cap }) => {
			const t0 = performance.now();
			const cam = () => {
				const c = globalThis.__decksRust?.camera;
				return c ? [Math.round(c.x), Math.round(c.y), Math.round(c.zoom * 1000)] : null;
			};
			const snap = () => JSON.stringify([globalThis.__t.state(), document.querySelector(".stage")?.dataset.moving, cam()]);
			let last = snap();
			let at = performance.now();
			while (performance.now() - t0 < cap) {
				await new Promise((done) => setTimeout(done, 100));
				const now = snap();
				if (now !== last || document.querySelector(".stage")?.dataset.moving === "true") {
					last = now;
					at = performance.now();
				} else if (performance.now() - at >= ms) return true;
			}
			return false;
		},
		{ ms, cap },
	);
await canvas.waitForFunction(() => !!globalThis.__decksRust?.camera, undefined, { timeout: 20000 }).catch(() => {});
if (shots) {
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${shots}/awake-engine-up.png` });
}
const items = await canvas.evaluate(() => globalThis.__decksCards().map((c) => c.path));
const appPaths = items.filter((p) => /^item:aa/.test(p));
const docPaths = items.filter((p) => /^item:ad/.test(p));
const cardPaths = items.filter((p) => /cards\//.test(p));
say("three apps, one document and three cards are placed", appPaths.length === 3 && docPaths.length === 1 && cardPaths.length === 3, items.join(" "));

// --- below the live zoom: pictures only -----------------------------------------------------------------
const view = (zoom) => canvas.evaluate(async ({ z, x, y }) => {
	await globalThis.__t.zoomTo(z);
	await globalThis.__t.panTo(x, y);
}, { z: zoom, x: -1400 / 2 / zoom + 700, y: -900 / 2 / zoom + 500 });
at("30%");
await view(0.3);
await rest();
let state = await canvas.evaluate(() => globalThis.__t.state());
say("at 30% no item of any kind has a node: every card, app and document is its picture", state.nodes.length === 0 && state.apps.length === 0 && state.documents === 0 && state.cardHosts === 0, JSON.stringify(state));
// The sheet draws the document's picture, once the server has made one (its file rendered as a card).
const docPictured = await until(async () => (await canvas.evaluate(() => globalThis.__decksPictured?.() ?? [])).includes(docPaths[0]), 20000);
say("…and the document is drawn as its picture, of its file", !!docPictured, JSON.stringify(await canvas.evaluate(() => globalThis.__decksPictured?.() ?? [])));
if (shots) {
	await page.screenshot({ path: `${shots}/awake-30.png` });
	// The document, centred at 30%, as its picture.
	const doc = await canvas.evaluate((path) => {
		const c = globalThis.__decksCards().find((one) => one.path === path);
		const cam = globalThis.__decksRust.camera;
		const r = document.querySelector(".stage").getBoundingClientRect();
		return { x: cam.x + (c.rect.left - r.left + c.rect.width / 2) / cam.zoom, y: cam.y + (c.rect.top - r.top + c.rect.height / 2) / cam.zoom };
	}, docPaths[0]);
	await canvas.evaluate(({ x, y }) => globalThis.__t.panTo(x - 1400 / 2 / 0.3, y - 900 / 2 / 0.3), doc);
	await rest();
	await page.screenshot({ path: `${shots}/awake-doc.png` });
}

// --- at 60%: everything near is awake, within its kind's budget ---------------------------------------
at("60%");
await view(0.6);
await rest();
// Apps load their windows after the rest: wait for the budget's two, up to a few seconds.
await until(async () => (await canvas.evaluate(() => globalThis.__t.state())).apps.length >= 2, 8000);
state = await canvas.evaluate(() => globalThis.__t.state());
const nearApps = await canvas.evaluate(() => {
	const r = document.querySelector(".stage").getBoundingClientRect();
	const mx = r.width / 2;
	const my = r.height / 2;
	const far = (c) => Math.hypot(Math.max(c.rect.left - r.left - mx, 0, mx - (c.rect.right - r.left)), Math.max(c.rect.top - r.top - my, 0, my - (c.rect.bottom - r.top)));
	return globalThis.__decksCards().filter((c) => /^item:aa/.test(c.path)).sort((a, b) => far(a) - far(b)).map((c) => c.path);
});
say("at 60% the cards near the screen and the document are awake, with nodes", cardPaths.every((p) => state.nodes.includes(p)) && state.documents === 1 && state.cardHosts === 3, JSON.stringify(state));
say("…and of three apps near, the two nearest the middle run (the computer's budget of two)", state.apps.length === 2 && state.apps.includes(nearApps[0]) && state.apps.includes(nearApps[1]), `${JSON.stringify(state.apps)} nearest ${JSON.stringify(nearApps)}`);
// --- a resize keeps the card's document: its root stays, its scripts are not started over -------------------
at("resize");
const liveCard = cardPaths[0];
const marked = await canvas.evaluate((path) => {
	const node = [...document.querySelectorAll(".world .card-node")].find((n) => n.dataset.path === path);
	const host = node?.querySelector(".card-host");
	if (!host) return false;
	host.dataset.mark = "before-resize";
	node.dataset.mark = "before-resize";
	return true;
}, liveCard);
say("the live card has its root, marked", marked);
const sizeBefore = await canvas.evaluate((path) => globalThis.__decksCards().find((c) => c.path === path)?.rect.width, liveCard);
const resized = await call("canvas.update", [liveCard, { size: { w: 900, h: 760 } }, { canvas: CANVAS }]);
say("the card is resized by the API", resized.ok === true, JSON.stringify(resized.error ?? "").slice(0, 120));
const grew = await until(async () => {
	const w = await canvas.evaluate((path) => globalThis.__decksCards().find((c) => c.path === path)?.rect.width, liveCard);
	return w !== sizeBefore ? w : undefined;
}, 8000);
say("…and the stage shows the new size", !!grew, `${sizeBefore} -> ${grew}`);
await page.waitForTimeout(2500);
const kept = await canvas.evaluate((path) => {
	const node = [...document.querySelectorAll(".world .card-node")].find((n) => n.dataset.path === path);
	const page = globalThis.__decksCards().find((c) => c.path === path);
	return { node: node?.dataset.mark === "before-resize", host: node?.querySelector(".card-host")?.dataset.mark === "before-resize", sized: page?.sized, rev: page?.rev, nodesForPath: [...document.querySelectorAll(".world .card-node")].filter((n) => n.dataset.path === path).map((n) => n.dataset.mark ?? "-"), made: globalThis.__decksMade?.[path] };
}, liveCard);
say("…and the card keeps the document it had: the same root, its scripts not started over", kept.host, JSON.stringify(kept));

say("…and a sleeping app has no node: it is its picture, not a bar and a button", !state.nodes.includes(nearApps[2]), JSON.stringify(state.nodes));

// --- an app that becomes nearest takes a place ----------------------------------------------------------
at("third app");
const third = await canvas.evaluate((path) => {
	const c = globalThis.__decksCards().find((one) => one.path === path);
	const cam = globalThis.__decksRust.camera;
	const r = document.querySelector(".stage").getBoundingClientRect();
	// World point of the third app's middle, from its screen rect.
	return { x: cam.x + (c.rect.left - r.left + c.rect.width / 2) / cam.zoom, y: cam.y + (c.rect.top - r.top + c.rect.height / 2) / cam.zoom };
}, nearApps[2]);
await canvas.evaluate(({ x, y }) => globalThis.__t.panTo(x - 1400 / 2 / 0.6, y - 900 / 2 / 0.6), third);
await rest();
await until(async () => (await canvas.evaluate(() => globalThis.__t.state())).apps.includes(nearApps[2]), 8000);
state = await canvas.evaluate(() => globalThis.__t.state());
say("panned so the third app is under the middle, it runs, and the farthest app sleeps, kept under its picture", state.apps.includes(nearApps[2]) && state.apps.length === 2 && state.kept.some((path) => /^item:aa/.test(path)) && !state.apps.includes(state.kept.find((path) => /^item:aa/.test(path))), `live ${JSON.stringify(state.apps)} kept ${JSON.stringify(state.kept)}`);

// --- nothing mounts mid-pinch -----------------------------------------------------------------------------
at("pinch");
const added = await canvas.evaluate(async () => {
	let added = 0;
	const observer = new MutationObserver((list) => {
		for (const m of list) for (const n of m.addedNodes) if (n instanceof Element && (n.matches(".card-node") || n.querySelector?.(".card-node"))) added++;
	});
	observer.observe(document.querySelector(".world"), { childList: true, subtree: true });
	await globalThis.__t.zoomTo(1.0);
	const mid = added;
	observer.disconnect();
	return mid;
});
say("a pinch from 60% to 100% mounts nothing while it moves", added === 0, `${added} nodes added mid-pinch`);
await rest();

// --- select first on an app ------------------------------------------------------------------------------
await view(0.6);
await rest();
at("select first");
const takes = () => canvas.evaluate(() => [...document.querySelectorAll('.card-node[data-state="live"] .app-surface-frame')].map((f) => getComputedStyle(f).pointerEvents));
const before = await takes();
say("before it is selected a running app takes no pointer", before.length > 0 && before.every((p) => p === "none"), JSON.stringify(before));
const frameBox = await page.locator("iframe.canvas-frame").boundingBox();
// Where the first running app's window is, as the frame sees it now (a locator's box can be stale after a glide).
const rectNow = () =>
	canvas.evaluate(() => {
		const r = document.querySelector('.card-node[data-state="live"] .app-surface[data-live]')?.closest(".card-node")?.getBoundingClientRect();
		const stage = document.querySelector(".stage");
		const c = globalThis.__decksRust?.camera;
		return r ? { x: r.x, y: r.y, width: r.width, height: r.height, scroll: [stage?.scrollLeft, stage?.scrollTop], camera: c && [Math.round(c.x), Math.round(c.y), c.zoom] } : undefined;
	});
// Centred on the screen first: the page's side panel floats over the frame's left edge, and a press there is the panel's.
const centre = await canvas.evaluate(() => {
	const r = document.querySelector('.card-node[data-state="live"] .app-surface[data-live]')?.closest(".card-node")?.getBoundingClientRect();
	const cam = globalThis.__decksRust.camera;
	const stage = document.querySelector(".stage").getBoundingClientRect();
	return { x: cam.x + (r.x - stage.x + r.width / 2) / cam.zoom, y: cam.y + (r.y - stage.y + r.height / 2) / cam.zoom };
});
await canvas.evaluate(({ x, y }) => globalThis.__t.panTo(x - 1400 / 2 / 0.6, y - 900 / 2 / 0.6), centre);
await rest();
const box = await rectNow();
const moved = box;
const clickAt = { x: box.x + box.width / 2, y: box.y + box.height * 0.7 };
await page.mouse.click(frameBox.x + clickAt.x, frameBox.y + clickAt.y);
const after = await until(async () => ((await takes()).includes("auto") ? await takes() : undefined), 4000);
const under = await canvas.evaluate(({ x, y }) => {
	const el = document.elementFromPoint(x, y);
	const node = document.querySelector('.card-node[data-state="live"] .app-surface[data-live]')?.closest(".card-node");
	const r = node?.getBoundingClientRect();
	return { at: { x, y }, under: `${el?.tagName}.${el?.className?.toString().slice(0, 40)}`, node: node && { path: node.dataset.path, inert: node.dataset.inert, rect: [r.x, r.y, r.width, r.height].map(Math.round) }, selected: [...document.querySelectorAll('.card-node[data-selected="true"]')].map((n) => n.dataset.path) };
}, clickAt);
say("…selected, its window takes the pointer", !!after && after.includes("auto"), `${JSON.stringify(after ?? (await takes()))} ${JSON.stringify(under)} box ${JSON.stringify(box)} after move ${JSON.stringify(moved)}`);
// --- the pill's New tab opens the item in a tab, through the page: the frame's sandbox allows no popup ---------
at("pill new tab");
{
	// Centred on the card first: it is off the screen after the app's section.
	const middle = await canvas.evaluate((path) => {
		const c = globalThis.__decksCards().find((one) => one.path === path);
		const cam = globalThis.__decksRust.camera;
		const st = document.querySelector(".stage").getBoundingClientRect();
		return { x: cam.x + (c.rect.left - st.left + c.rect.width / 2) / cam.zoom, y: cam.y + (c.rect.top - st.top + c.rect.height / 2) / cam.zoom };
	}, cardPaths[0]);
	await canvas.evaluate(({ x, y }) => globalThis.__t.panTo(x - 1400 / 2 / 0.6, y - 900 / 2 / 0.6), middle);
	await rest();
	const r = await canvas.evaluate((path) => { const c = globalThis.__decksCards().find((one) => one.path === path); return [c.rect.x, c.rect.y, c.rect.width, c.rect.height]; }, cardPaths[0]);
	// Near its top: the selected app's pill sits over the card's foot.
	await page.mouse.click(frameBox.x + r[0] + r[2] / 2, frameBox.y + r[1] + r[3] * 0.3);
	const picked = await until(async () => ((await canvas.evaluate(() => globalThis.__decksAwake?.().selected)) === cardPaths[0] ? true : undefined), 5000);
	const hit = await canvas.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return `${el?.tagName}.${el?.className?.toString().slice(0, 40)} in ${el?.closest?.(".card-node")?.dataset.path?.split("/").at(-2) ?? "-"}`; }, { x: r[0] + r[2] / 2, y: r[1] + r[3] * 0.3 });
	say("a press on the card selects it", !!picked, `${String(await canvas.evaluate(() => globalThis.__decksAwake?.().selected))}; under the press: ${hit}`);
	const pill = await until(async () => ((await canvas.locator('.card-callout a[aria-label="New tab"]').count()) > 0 ? true : undefined), 5000);
	say("a press on a card shows its pill with New tab", !!pill);
	if (pill) {
		const opened = context.waitForEvent("page", { timeout: 6000 }).catch(() => undefined);
		// Pressed as an element: the pill moves with the camera's settling, and Playwright waits for it to hold still.
		const pressed = await canvas.locator('.card-callout a[aria-label="New tab"]').first().evaluate((el) => (el.click(), true), undefined, { timeout: 5000 }).catch((error) => String(error.message).slice(0, 80));
		say("…its New tab is pressed", pressed === true, String(pressed));
		const tab = await opened;
		say("…and New tab opens the card in a tab of its own", !!tab && /awake-000/.test(tab.url()), tab ? tab.url().slice(0, 100) : "no page opened");
		await tab?.close().catch(() => {});
	}
}

// A wheel inside the selected app that its page cannot scroll with pans the canvas, and a pinch zooms it, as over a card.
at("wheel in app");
const appFrame = page.frames().find((one) => !one.isDetached() && one.url().includes("/app/t/") && one.url().includes("/small-app-"));
say("the app's page is loaded in its iframe", !!appFrame, page.frames().map((f) => f.url().slice(0, 60)).join(" | "));
if (appFrame) {
	const camBefore = await canvas.evaluate(() => ({ ...globalThis.__decksRust.camera }));
	await appFrame.evaluate(() => {
		for (let i = 0; i < 6; i++) document.body.dispatchEvent(new WheelEvent("wheel", { deltaX: 40, deltaY: 0, clientX: 200, clientY: 300, bubbles: true, cancelable: true }));
	});
	const panned = await until(async () => {
		const cam = await canvas.evaluate(() => ({ ...globalThis.__decksRust.camera }));
		return Math.abs(cam.x - camBefore.x) > 20 ? cam : undefined;
	}, 4000);
	say("a wheel inside the live app that its page cannot use pans the canvas", !!panned, `camera x ${camBefore.x} -> ${panned?.x ?? (await canvas.evaluate(() => globalThis.__decksRust.camera.x))}`);
	await appFrame.evaluate(() => {
		for (let i = 0; i < 6; i++) document.body.dispatchEvent(new WheelEvent("wheel", { deltaX: 0, deltaY: -30, ctrlKey: true, clientX: 200, clientY: 300, bubbles: true, cancelable: true }));
	});
	const zoomed = await until(async () => {
		const cam = await canvas.evaluate(() => ({ ...globalThis.__decksRust.camera }));
		return Math.abs(cam.zoom - camBefore.zoom) > 0.02 ? cam : undefined;
	}, 4000);
	say("…and a pinch inside it zooms the canvas", !!zoomed, `zoom ${camBefore.zoom} -> ${zoomed?.zoom ?? (await canvas.evaluate(() => globalThis.__decksRust.camera.zoom))}`);
	await view(0.6);
	await rest();
}
// --- one press in a document selects it and acts ----------------------------------------------------------
at("document press");
const docCentre = await canvas.evaluate((path) => {
	const c = globalThis.__decksCards().find((one) => one.path === path);
	const cam = globalThis.__decksRust.camera;
	const r = document.querySelector(".stage").getBoundingClientRect();
	return { x: cam.x + (c.rect.left - r.left + c.rect.width / 2) / cam.zoom, y: cam.y + (c.rect.top - r.top + c.rect.height / 2) / cam.zoom };
}, docPaths[0]);
await canvas.evaluate(({ x, y }) => globalThis.__t.panTo(x - 1400 / 2 / 0.6, y - 900 / 2 / 0.6), docCentre);
await rest();
await until(async () => (await canvas.evaluate(() => globalThis.__t.state())).documents >= 1, 8000);
const docBox = await canvas.evaluate((path) => {
	const r = [...document.querySelectorAll(".world .card-node")].find((n) => n.dataset.path === path)?.getBoundingClientRect();
	return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : undefined;
}, docPaths[0]);
say("the document is awake under the middle, with its editor", !!docBox, JSON.stringify(docBox));
if (docBox) {
	await page.mouse.click(frameBox.x + docBox.x + docBox.width / 2, frameBox.y + docBox.y + docBox.height * 0.5);
	const picked = await until(async () => canvas.evaluate((path) => [...document.querySelectorAll('.card-node[data-selected="true"]')].some((n) => n.dataset.path === path), docPaths[0]), 3000);
	const focusIn = await canvas.evaluate((path) => {
		const node = [...document.querySelectorAll(".world .card-node")].find((n) => n.dataset.path === path);
		return !!node && node.contains(document.activeElement);
	}, docPaths[0]);
	say("one press inside the document selects it and reaches its editor, as a press in a card does", !!picked && focusIn, `selected ${!!picked}, focus inside ${focusIn}`);
}
// --- zoomed back out, the apps that ran are their pictures, as cards are ------------------------------------
at("back to 30%");
await view(0.3);
await rest();
const appsPictured = await until(async () => {
	const pictured = await canvas.evaluate(() => globalThis.__decksPictured?.() ?? []);
	return appPaths.every((path) => pictured.includes(path)) ? pictured : undefined;
}, 10000);
say("zoomed out to 30%, every app, the ones that ran included, is drawn as its picture, as a card is", !!appsPictured, JSON.stringify(await canvas.evaluate(() => (globalThis.__decksPictured?.() ?? []).filter((p) => p.startsWith("item:")))));
// --- below 40%, a press on a picture wakes it, and a press elsewhere puts it back to sleep: a card and an app alike ----
at("wake by press");
const pressPicture = async (path, label) => {
	// Centred first, so the press is clear of the page's panels.
	const centre = await canvas.evaluate((path) => {
		const c = globalThis.__decksCards().find((one) => one.path === path);
		const cam = globalThis.__decksRust.camera;
		const r = document.querySelector(".stage").getBoundingClientRect();
		return { x: cam.x + (c.rect.left - r.left + c.rect.width / 2) / cam.zoom, y: cam.y + (c.rect.top - r.top + c.rect.height / 2) / cam.zoom };
	}, path);
	await canvas.evaluate(({ x, y }) => globalThis.__t.panTo(x - 1400 / 2 / 0.3, y - 900 / 2 / 0.3), centre);
	await rest();
	const asleep = await canvas.evaluate((path) => ({ pictured: (globalThis.__decksPictured?.() ?? []).includes(path), live: globalThis.__decksAwake?.().live.includes(path) }), path);
	say(`${label}: asleep at 30%, its picture on the sheet`, asleep.pictured && !asleep.live, JSON.stringify(asleep));
	const r = await canvas.evaluate((path) => { const c = globalThis.__decksCards().find((one) => one.path === path); return [c.rect.x, c.rect.y, c.rect.width, c.rect.height]; }, path);
	await page.mouse.click(frameBox.x + r[0] + r[2] / 2, frameBox.y + r[1] + r[3] * 0.7);
	const woke = await until(async () => {
		const got = await canvas.evaluate((path) => ({ selected: globalThis.__decksAwake?.().selected, live: globalThis.__decksAwake?.().live.includes(path), node: [...document.querySelectorAll('.card-node[data-state="live"]')].some((n) => n.dataset.path === path) }), path);
		return got.selected === path && got.live && got.node ? got : undefined;
	}, 8000);
	say(`${label}: a press on its picture selects it and it goes live, below 40% too`, !!woke, JSON.stringify(woke ?? (await canvas.evaluate(() => globalThis.__decksAwake?.()))));
	// A press on bare canvas, far from it, lets it go.
	await page.mouse.click(frameBox.x + 1300, frameBox.y + 100);
	const slept = await until(async () => {
		const got = await canvas.evaluate((path) => ({ selected: globalThis.__decksAwake?.().selected, live: globalThis.__decksAwake?.().live.includes(path), pictured: (globalThis.__decksPictured?.() ?? []).includes(path) }), path);
		return got.selected !== path && !got.live && got.pictured ? got : undefined;
	}, 8000);
	const why = slept ?? (await canvas.evaluate((path) => { const n = [...document.querySelectorAll(".world .card-node")].find((n) => n.dataset.path === path); const e = globalThis.__decksRust; const placed = e?.placedCards?.find((c) => c.path === path); return { awake: globalThis.__decksAwake?.(), pictured: (globalThis.__decksPictured?.() ?? []).includes(path), node: n && { ...n.dataset }, placed: placed && { live: placed.live, ready: placed.ready, picture: placed.picture?.slice(-40) }, held: e?.heldWidth?.get(`card:${path}`), bytes: e?.pictureBytes?.get(`card:${path}`), rustPictured: e?.page?.pictured?.(), liveKey: e?.liveKey }; }, path));
	say(`${label}: unselected below 40%, it sleeps and is its picture again`, !!slept, `${JSON.stringify(why)} pictures: ${JSON.stringify(pictureLog.filter((l) => l.includes(nameOf(path))).slice(-6))}`);
};
await pressPicture(cardPaths[0], "card");
await pressPicture(appPaths[0], "app");
say("no page errors", errors.length === 0, errors.join(" | "));
await page.close().catch(() => {});
// The harness's socket would keep the process alive.
process.exit(0);
