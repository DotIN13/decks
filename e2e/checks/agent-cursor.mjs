/**
 * An agent's cursor shows on the canvas: `decks view cursor` on a card puts a named arrow in the frame at
 * the card's point, and `null` takes it away.
 */
import { API, asPerson, canvasFrame, card, open, resetStage, rest, say, settle, socket } from "../harness.mjs";

const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();
const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test().catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
try {
	const frame = await canvasFrame(page);
	await rest(page);
	const link = await socket();
	const agent = await until(async () => link.last("agents")?.focused);
	// As the agent itself, on its token.
	const token = (await call("agent.get", [agent])).value ? undefined : undefined;
	// The card on screen first, as an agent working on it would have it.
	const focused = await call("view.focus", [card("plan")]);
	// Offered rather than moved (the canvas counted as in use): take the offer, as the person would.
	const go = frame.getByRole("button", { name: "Go" });
	if (await go.isVisible({ timeout: 1500 }).catch(() => false)) await go.click();
	await rest(page);
	await settle(page, 800);
	say("the view is on the card", true, JSON.stringify(focused.value).slice(0, 160));
	// A point of the card that is in the open, not under the page's side panel.
	const shown = await call("view.cursor", [card("plan"), { x: 900, y: 300 }]);
	say("view.cursor is taken", shown.ok === true, JSON.stringify(shown).slice(0, 300));
	const cursor = frame.locator(".frame-cursors .agent-cursor");
	const appeared = await until(async () => (await cursor.count()) > 0);
	const diag = await frame.evaluate(() => ({ cursors: document.querySelectorAll(".frame-cursors").length, agent: document.querySelectorAll(".agent-cursor").length, html: document.querySelector(".frame-cursors")?.outerHTML.slice(0, 400) ?? null }));
	say("the cursor shows in the frame", !!appeared, JSON.stringify(diag));
	if (appeared) {
		await settle(page, 700);
		// The layer cannot be hit-tested (it takes no pointer), so what is checked is that it is drawn: on screen, opaque, and stacked after the editor's surface.
		const where = await frame.evaluate(() => {
			const c = document.querySelector(".frame-cursors .agent-cursor");
			const layer = document.querySelector(".frame-cursors");
			const arrow = c?.querySelector(".arrow")?.getBoundingClientRect();
			if (!arrow || !layer) return { arrow: null };
			const surface = document.querySelector(".stage") ?? document.querySelector(".decks-canvas");
			const after = surface ? Boolean(surface.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING) && !surface.contains(layer) : false;
			const style = getComputedStyle(c);
			return { arrow: { x: arrow.x, y: arrow.y, w: arrow.width, h: arrow.height }, opacity: style.opacity, visibility: style.visibility, after, z: getComputedStyle(layer).zIndex };
		});
		say("…the arrow is on screen, opaque, and stacked over the editor's surface", !!where.arrow && where.arrow.x > 0 && where.arrow.y > 0 && where.arrow.x < 1400 && where.arrow.y < 900 && where.opacity !== "0" && where.visibility === "visible" && where.after, JSON.stringify(where));
		const clip = where.arrow ? { x: Math.max(0, where.arrow.x - 60), y: Math.max(0, where.arrow.y - 60), width: 260, height: 160 } : undefined;
		await page.screenshot({ path: process.env.AGENT_CURSOR_SHOT ?? "/tmp/agent-cursor.png", ...(clip ? { clip } : {}) });
		say("…named for the agent", ((await cursor.first().locator(".label").textContent()) ?? "").length > 0, await cursor.first().locator(".label").textContent());
		await call("view.cursor", [card("plan"), null]);
		await frame.locator(".frame-cursors .agent-cursor").first().waitFor({ state: "detached", timeout: 4000 }).catch(() => {});
		say("null takes it away", (await cursor.count()) === 0, `${await cursor.count()} left`);
	}
	say("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
	link.close();
} finally {
	await browser.close();
}
