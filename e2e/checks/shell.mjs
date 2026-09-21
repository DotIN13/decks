/**
 * The one-page shell: the dashboard and a stage share one window, and the hash says which.
 *
 * What only a browser can prove:
 *
 * - the app opens on the dashboard, with the hash written, and no conversation opened;
 * - a board previewed from the gallery zooms, by a gesture made over its own frame;
 * - a row in the panel opens that agent's stage, and Home comes back to the same tab;
 * - Back after a row press is Home; a reload lands where the hash says;
 * - a half-typed line survives the switch, and the count of board documents does not move;
 * - the composer, dragged off its home, is where it was dropped after a reload;
 * - thrown hard at the right edge it is put away behind a tab, and the tab brings it back;
 * - Escape on a stage with nothing selected goes Home.
 */
import { open, ready, say, settle, socket, WEB } from "../harness.mjs";

// `boards: false`: the harness opens on the stage for the rest of the suite; this check is
// about the landing, so it goes to the front door itself.
const { browser, page, errors } = await open({ width: 1500, height: 1000, boards: false });
await page.goto(`${WEB}/`, { waitUntil: "load" });
await page.waitForSelector(".surface");
await settle(page, 1200);
const LINK = await socket();

// The focused agent, not the first row: pressing its row is a change of surface and nothing
// else, which is what the draft assertion is about. Switching agent clears the draft on
// purpose, as it always has, because a draft belongs to a conversation.
let agentId = "";
for (let i = 0; i < 30 && !agentId; i++) {
	agentId = LINK.last("agents")?.focused ?? LINK.last("agents")?.chats?.[0]?.id ?? "";
	if (!agentId) await settle(page, 200);
}
if (!agentId) throw new Error("the fixture deck has no agent to open a stage for");

const hash = () => page.evaluate(() => location.hash);
const surface = () => page.getAttribute(".surface", "data-surface");
const documents = () => page.evaluate(() => document.querySelectorAll(".surface-layer[data-layer='stage'] iframe").length);

say("the app opens on the dashboard's shelf of canvases, and writes the hash", (await hash()) === "#/canvases" && (await surface()) === "dispatch", `${await hash()} ${await surface()}`);
say("the dashboard's tabs are drawn in the top-left pill", (await page.locator('.pill [role="tab"]').count()) === 4);
/* The gallery of every board is a tab of its own now, one press from the canvases. */
await page.locator('.pill [role="tab"]', { hasText: "Boards" }).click();
await settle(page, 600);
say("…and the Boards tab is the gallery", (await hash()) === "#/boards", await hash());

/*
 * Every card has a picture the server took (`boards/thumbs.ts`), of a board this browser
 * has never had open. It used to be a grey tile with the title on it until the board had
 * been on this browser's canvas. 640 real pixels wide, and asked for by revision so it can
 * be cached for a year.
 */
{
	const ready = await page
		.waitForFunction(
			() => {
				const pictures = [...document.querySelectorAll(".dispatch-card-pic .board-picture")];
				return pictures.length > 0 && pictures.every((one) => one.dataset.state === "ready");
			},
			undefined,
			{ timeout: 30000 },
		)
		.then(() => true)
		.catch(() => false);
	const pictures = await page.evaluate(() =>
		[...document.querySelectorAll('.dispatch-card-pic img[data-thumb="ready"]')].map((one) => ({ w: one.naturalWidth, src: one.getAttribute("src") })),
	);
	say("every gallery card gets a picture taken by the server", ready && pictures.length > 0, JSON.stringify(pictures));
	say("…720 pixels wide, asked for by revision and scheme", pictures.every((one) => one.w === 720 && /\/api\/thumb\/.+\?v=\d+&scheme=(light|dark)$/.test(one.src)), JSON.stringify(pictures));
	const again = await page.evaluate(async (src) => {
		const started = performance.now();
		const answer = await fetch(src, { cache: "no-store" });
		return { status: answer.status, type: answer.headers.get("content-type"), cache: answer.headers.get("cache-control"), ms: Math.round(performance.now() - started) };
	}, pictures[0]?.src);
	/* The left panel's rows draw the same pictures: there is no second way to picture a board,
	   and no board is mounted as a document to make one. */
	await page.waitForFunction(() => [...document.querySelectorAll(".board-thumb .board-picture")].some((one) => one.dataset.state === "ready"), undefined, { timeout: 15000 }).catch(() => {});
	const rows = await page.evaluate(() => ({
		rows: document.querySelectorAll(".board-row").length,
		ready: document.querySelectorAll('.board-thumb .board-picture[data-state="ready"]').length,
		server: [...document.querySelectorAll(".board-thumb img")].every((one) => (one.getAttribute("src") ?? "").startsWith("/api/thumb/")),
		frames: document.querySelectorAll(".panel-shell iframe").length,
	}));
	say("the left panel's rows draw the server's pictures too, with no document mounted", rows.rows > 0 && rows.ready === rows.rows && rows.server && rows.frames === 0, JSON.stringify(rows));
	say("…and a second ask is answered from the disk, cacheable for a year", again.status === 200 && again.type === "image/jpeg" && /immutable/.test(again.cache ?? "") && again.ms < 300, JSON.stringify(again));
}

/*
 * The preview zooms, and the gesture is heard inside the board's frame. The frame is a
 * separate document, so a ⌘-wheel over it reaches nothing in the app unless the preview
 * listens there too, which is how this was broken without anything failing.
 */
await page.locator(".dispatch-card-open").first().click();
await page.waitForSelector(".dispatch-preview-frame");
await settle(page, 1200);
const drawn = () =>
	page.evaluate(() => {
		const frame = document.querySelector(".dispatch-preview-frame");
		return frame ? frame.getBoundingClientRect().width / frame.offsetWidth : 0;
	});
const fitted = await drawn();
const pane = await page.locator(".dispatch-preview-frame").boundingBox();
await page.mouse.move(pane.x + pane.width / 2, pane.y + 120);
await page.keyboard.down("Control");
await page.mouse.wheel(0, -100);
await page.mouse.wheel(0, -100);
await page.keyboard.up("Control");
await settle(page, 200);
const zoomed = await drawn();
say("a ⌘-wheel over the previewed board zooms the preview", zoomed > fitted * 1.5, `${fitted.toFixed(3)} -> ${zoomed.toFixed(3)}`);
await page.keyboard.press("Control+0");
await settle(page, 100);
say("⌘0 fits the preview to the panel again", Math.abs((await drawn()) - fitted) < 0.001, `${await drawn()}`);
await page.click('[aria-label="Zoom in"]');
say("the header's zoom button zooms it too", (await drawn()) > fitted * 1.1);
await page.click('[aria-label="Close preview"]');
await settle(page, 300);

// A row in the panel. The panel is open at this width; the Agents tab may not be the one showing.
const agentsTab = page.locator('.panel-shell [role="tab"]', { hasText: "Agents" });
if (await agentsTab.count()) await agentsTab.first().click();
await settle(page, 400);
say("the dashboard's bar offers the dispatcher's runtime", (await page.locator(".dock .runtime-chip").count()) === 1 && /^Dispatcher runtime: \S/.test((await page.locator(".dock .runtime-chip").getAttribute("aria-label")) ?? ""), await page.locator(".dock .runtime-chip").getAttribute("aria-label"));
say("no board document is started while the dashboard is up", (await documents()) === 0, `${await documents()} documents`);
await page.fill(".dockfield", "half a line, typed before the switch");
await page.locator('.panel-shell .agent-row[data-current="true"] button[data-agent]').first().click();
await settle(page, 700);
await ready(page);
const before = await documents();
say("a row in the panel opens that agent's stage", (await hash()) === `#/agent/${agentId}` && (await surface()) === "stage", `${await hash()} ${await surface()}`);
say("Home grows into the pill on a stage", (await page.locator('.pill-home[data-on="true"]').count()) === 1);
say("the bar's word is the agent's on a stage", /^to /.test((await page.locator(".dock-to").textContent()) ?? "") && !/dispatcher/.test((await page.locator(".dock-to").textContent()) ?? ""), await page.locator(".dock-to").textContent());
say("…and a stage's bar does not: its agent's runtime was fixed when it was made", (await page.locator(".dock .runtime-chip").count()) === 0);
/* @Dispatcher is a name from any bar: on a stage it turns the line into a task. Read off the
   bar's own word, which is the send's decision run without sending. */
await page.fill(".dockfield", "@Dispatcher find someone for this");
await settle(page, 200);
say("@Dispatcher on a stage addresses the dispatcher", (await page.locator(".dock-to").textContent()) === "to dispatcher", await page.locator(".dock-to").textContent());
await page.fill(".dockfield", "");
await settle(page, 200);
say("…and without it the bar is the agent's again", /^to /.test((await page.locator(".dock-to").textContent()) ?? "") && !/dispatcher/.test((await page.locator(".dock-to").textContent()) ?? ""));

await page.click('[aria-label="Home: back to the dashboard"]');
await settle(page, 700);
say("Home comes back to the dashboard, on the tab it left", (await hash()) === "#/boards" && (await surface()) === "dispatch", `${await hash()}`);
say("the draft survives the switch", (await page.locator(".dockfield").evaluate((el) => el.textContent)) === "half a line, typed before the switch");
say("the bar's word is the dispatcher's on the dashboard", (await page.locator(".dock-to").textContent()) === "to dispatcher", await page.locator(".dock-to").textContent());
say("no board document was torn down by the switch", (await documents()) === before, `${before} -> ${await documents()}`);

await page.goBack();
await settle(page, 600);
say("Back after Home is the stage again", (await hash()) === `#/agent/${agentId}` && (await surface()) === "stage", `${await hash()}`);
await page.keyboard.press("Escape");
await settle(page, 600);
say("Escape on a stage with nothing selected goes Home", (await surface()) === "dispatch", `${await hash()}`);

// The composer, dragged off its home, and still there after a reload.
const box = await page.locator(".dockbox").boundingBox();
await page.mouse.move(box.x + 16, box.y + 6);
await page.mouse.down();
await page.mouse.move(box.x - 300, box.y - 260, { steps: 12 });
await page.mouse.up();
// A release with velocity is a throw, and the glide after it can take up to 420ms.
await settle(page, 700);
const dropped = await page.evaluate(() => document.querySelector(".dock")?.getBoundingClientRect().left);
say("the composer floats where it is dropped", (await page.getAttribute(".dock", "data-floating")) === "true", `left ${dropped}`);
const saved = await page.evaluate(() => localStorage.getItem("decks.floats") ?? "");
say("the drop is written to storage as a share of the column", /"composer":\{"fx":[0-9.]+,"fy":[0-9.]+\}/.test(saved), saved);
// The harness wipes storage on every load, so the saved value is put back by an init
// script of this check's own: what is tested across the reload is the restore.
await page.addInitScript((value) => {
	try {
		localStorage.setItem("decks.floats", value);
	} catch {
		/* no storage */
	}
}, saved);
await page.reload({ waitUntil: "load" });
await page.waitForSelector(".surface");
await settle(page, 1500);
const after = await page.evaluate(() => document.querySelector(".dock")?.getBoundingClientRect().left);
say("a reload puts the composer back where it was dropped", (await page.getAttribute(".dock", "data-floating")) === "true" && Math.abs((after ?? 0) - (dropped ?? -1)) < 2, `${dropped} -> ${after}`);
await page.dblclick(".dock-grip");
await settle(page, 700);
say("a double-click on the grip sends it home", (await page.getAttribute(".dock", "data-floating")) === null);

/*
 * Thrown hard at the right edge, the bar is put away and leaves a tab; the tab brings it
 * back. Five moves of 60px with no pause between them is a throw: the velocity at release
 * is what decides, and a drag that pauses before letting go parks against the edge instead.
 */
const grip = await page.locator(".dock-grip").boundingBox();
await page.mouse.move(grip.x + grip.width / 2, grip.y + 2);
await page.mouse.down();
for (let i = 1; i <= 5; i++) await page.mouse.move(grip.x + grip.width / 2 + i * 60, grip.y + 2);
await page.mouse.up();
await settle(page, 800);
const away = await page.evaluate(() => {
	const dock = document.querySelector(".dock");
	const tab = dock?.querySelector(".dock-stowtab")?.getBoundingClientRect();
	return { stowed: dock?.hasAttribute("data-stowed") ?? false, left: dock?.getBoundingClientRect().left ?? 0, tabRight: tab?.right ?? 0, inert: Boolean(dock?.querySelector(".dockbox")?.closest("[inert]")), width: window.innerWidth };
});
say("a hard throw at the right edge puts the composer away", away.stowed && away.left > away.width - 60, JSON.stringify(away));
say("what is left on screen is its tab, against the edge, and the box is out of reach", Math.abs(away.tabRight - away.width) < 2 && away.inert, JSON.stringify(away));
await page.click(".dock-stowtab");
await settle(page, 900);
say("the tab brings it back to where it was", (await page.getAttribute(".dock", "data-stowed")) === null && (await page.getAttribute(".dock", "data-floating")) === null);

LINK.close();
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
