// The canvas helpers: a card selected, flown to, its pill's buttons pressed, its edges found.
import { canvasFrame, focusCanvas, onCanvasAt } from "./page.mjs";
import { rest } from "./waits.mjs";

export async function selectCard(page, path, { timeout = 4000 } = {}) {
	const canvas = await canvasFrame(page);
	// A board is its picture on the stage's sheet; a card, a document or an app awake has a node. The stage says where each is.
	const candidates = () => canvas.evaluate((wanted) => {
		const node = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted);
		const r = node?.getBoundingClientRect() ?? window.__decksProbes?.cards?.().find((one) => one.path === wanted)?.rect;
		if (!r) return [];
		const stage = document.querySelector(".stage");
		const out = [];
		for (const fy of [0.08, 0.2, 0.35, 0.5, 0.65, 0.8]) {
			for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9]) {
				const x = r.x + r.width * fx;
				const y = r.y + r.height * fy;
				if (x < 1 || y < 1 || x > innerWidth - 2 || y > innerHeight - 2) continue;
				const hit = document.elementFromPoint(x, y);
				if (node ? hit && hit.closest(".card-node") === node && !hit.closest("a, button, input, textarea, select") : (hit === stage || stage?.contains(hit)) && window.__decksProbes?.pictureAt?.(x, y) === wanted) out.push({ x, y });
			}
		}
		return out;
	}, path);
	// And not under the page's own chrome: the side panel, a top bar, the composer.
	const spot = async () => {
		for (const at of await candidates()) if (await onCanvasAt(page, at.x, at.y)) return at;
		return null;
	};
	let at = await spot();
	// Off screen, or under the chrome: fit the canvas, as a person looking for it would.
	if (!at) {
		const fitButton = canvas.locator('button[aria-label="Fit everything on the canvas"]').first();
		if (await fitButton.isVisible().catch(() => false)) {
			await fitButton.click();
			await rest(page);
			at = await spot();
		}
	}
	// Still under the composer or a panel: pan it to the middle of the window.
	if (!at) {
		const off = await canvas.evaluate((wanted) => {
			const node = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted);
			const r = node?.getBoundingClientRect() ?? window.__decksProbes?.cards?.().find((one) => one.path === wanted)?.rect;
			if (!r) return null;
			return { dx: r.x + r.width / 2 - innerWidth / 2, dy: r.y + r.height / 2 - innerHeight / 2 };
		}, path);
		if (off) {
			await page.mouse.move(innerWidthOf(page) / 2, 200);
			await page.mouse.wheel(off.dx, off.dy);
			await page.waitForTimeout(500);
			at = await spot();
		}
	}
	if (!at) {
		const why = await canvas.evaluate((wanted) => {
			const node = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted);
			const r = node?.getBoundingClientRect() ?? window.__decksProbes?.cards?.().find((one) => one.path === wanted)?.rect;
			if (!r) return "not on the canvas";
			const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
			return `at ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}, its middle under ${hit?.tagName.toLowerCase()}.${String(hit?.className ?? "").split(" ")[0]}`;
		}, path);
		throw new Error(`no uncovered point on ${path} to click: ${why}`);
	}
	await page.mouse.click(at.x, at.y);
	// The selected item's pill (`ui/Callout.tsx`).
	await canvas.waitForSelector(".card-callout:not([data-hidden])", { timeout });
	await page.waitForTimeout(150);
}

/**
 * Select a board the way a person does now that boards have no title bars: click it. The point is
 * one that is really on the board — not under the sidebar, a toolbar, the composer or the pill — and
 * then the card's pill (`ui/Callout.tsx`) is waited for.
 */
const innerWidthOf = (page) => page.viewportSize()?.width ?? 1440;

/** Select a board and fly the camera to it with the pill's Fit — what a double-click on its bar used to do. */
export async function flyToCard(page, path) {
	await selectCard(page, path);
	await pressCardAction(page, "Fit");
	await rest(page);
}

/**
 * One of the selected item's actions on its pill, by its word: Fit, Focus, New tab, Hide. `label` may
 * be a list, of which the first the pill offers is pressed; false when it offers none.
 */
export async function pressCardAction(page, label) {
	const labels = [label].flat();
	const canvas = await canvasFrame(page);
	/*
	 * The pill sits only over the item's top edge or under its bottom one and stays there, so with an
	 * item filling the screen it is off it, or under the composer: `1` frames the selected item, which
	 * is what Fit does, and brings the pill into the open for anything else.
	 */
	const pillAt = () =>
		canvas.evaluate(() => {
			const pill = document.querySelector(".stage-fixed > .card-callout");
			if (!pill || pill.hasAttribute("data-hidden")) return null;
			const r = pill.getBoundingClientRect();
			const x = r.x + r.width / 2;
			const y = r.y + r.height / 2;
			if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
			const hit = document.elementFromPoint(x, y);
			return hit && pill.contains(hit) ? { x, y } : null;
		});
	// The pill hides while the camera moves and comes back a moment after it rests.
	const shownPill = () => canvas.waitForFunction(() => { const pill = document.querySelector(".stage-fixed > .card-callout"); return !!pill && !pill.hasAttribute("data-hidden"); }, null, { timeout: 3000 }).catch(() => {});
	const at = await pillAt();
	if (!at || !(await onCanvasAt(page, at.x, at.y))) {
		await focusCanvas(page);
		await page.keyboard.press("1");
		if (labels.includes("Fit")) return true;
		await rest(page);
		await shownPill();
	}
	const pill = canvas.locator(`.card-callout :is(${labels.map((one) => `[role=menuitem][aria-label="${one}"]`).join(", ")})`).first();
	if ((await pill.count()) === 0) return false;
	// The button itself under the page's chrome (the side panel, say) though the pill's middle is not: framed once more, then pressed where it is.
	const button = await pill.boundingBox();
	if (button && !(await onCanvasAt(page, button.x + button.width / 2, button.y + button.height / 2))) {
		await focusCanvas(page);
		await page.keyboard.press("1");
		await rest(page);
		await shownPill();
	}
	const box = await pill.boundingBox();
	if (box && (await onCanvasAt(page, box.x + box.width / 2, box.y + box.height / 2))) return page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).then(() => true);
	return pill.click().then(() => true);
}

/**
 * A point on the band along an awake item's edge, which moves it (`item-slot.tsx`): on the screen
 * and uncovered, or null. The band shows on the item under the pointer or the selected one.
 */
export async function cardEdge(page, path) {
	const canvas = await canvasFrame(page);
	// The bands are drawn on the item under the pointer (or the selected one), so point at it first.
	const box = await canvas.locator(`.card-node[data-path="${path}"]`).boundingBox().catch(() => null);
	if (box) {
		const x = Math.min(Math.max(box.x + box.width / 2, 2), page.viewportSize().width - 2);
		const y = Math.min(Math.max(box.y + Math.min(box.height / 2, 40), 2), page.viewportSize().height - 2);
		await page.mouse.move(x, y);
		await canvas.waitForFunction((wanted) => [...document.querySelectorAll(".card-edge")].some((band) => band.closest(".card-node")?.dataset.path === wanted), path, { timeout: 2000 }).catch(() => {});
	}
	const points = await canvas.evaluate((wanted) => {
		const out = [];
		for (const band of document.querySelectorAll(".card-edge")) {
			if (band.closest(".card-node")?.dataset.path !== wanted) continue;
			const r = band.getBoundingClientRect();
			const along = band.dataset.side === "n" || band.dataset.side === "s";
			for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
				// The outer part of the band: clear of the item's own edge.
				const x = along ? r.x + r.width * f : band.dataset.side === "w" ? r.x + 3 : r.right - 3;
				const y = along ? (band.dataset.side === "n" ? r.y + 3 : r.bottom - 3) : r.y + r.height * f;
				if (x < 1 || y < 1 || x > innerWidth - 2 || y > innerHeight - 2) continue;
				if (document.elementFromPoint(x, y) === band) out.push({ x, y, side: band.dataset.side });
			}
		}
		return out;
	}, path);
	for (const at of points) if (await onCanvasAt(page, at.x, at.y)) return at;
	return null;
}
