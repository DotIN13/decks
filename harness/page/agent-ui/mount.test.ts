import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The entry mounted alone in a browser with a fake host: the conversation draws its cards, a tool call
// opens and asks for its whole result once, and a line typed into the composer reaches the host's send.
// A browser run: only with AGENT_UI_MOUNT=1, under the check slot (see the README).

const PAGE = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.AGENT_UI_PORT ?? 4697);

test("the entry mounts alone with a fake host", { skip: process.env.AGENT_UI_MOUNT !== "1" && "a browser run: set AGENT_UI_MOUNT=1" }, async () => {
	const { createServer } = await import("vite");
	const solid = (await import("vite-plugin-solid")).default;
	const { chromium } = await import("playwright");
	const server = await createServer({ root: PAGE, configFile: false, logLevel: "error", plugins: [solid()], server: { port: PORT, host: "127.0.0.1", strictPort: true } });
	await server.listen();
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`http://127.0.0.1:${PORT}/agent-ui/fixture/index.html`);
		await page.waitForSelector(".stream .stream-card", { timeout: 15000 });
		assert.ok((await page.locator(".stream-mine").innerText()).includes("Draw the plan"), "your message is drawn");
		assert.equal(await page.locator(".stream strong").innerText(), "the plan", "the reply's markdown is drawn");
		await page.locator(".tool > .row").first().click();
		await page.locator(".tool > .row").first().click();
		await page.locator(".tool > .row").first().click();
		const asked = await page.evaluate(() => (window as unknown as { agentUi: { asked: string[] } }).agentUi.asked);
		assert.deepEqual(asked, ["t1"], "a tool call opened again asks for its whole result once");
		await page.locator(".dockfield").click();
		await page.keyboard.type("Make it bigger");
		await page.keyboard.press("Enter");
		const sent = await page.evaluate(() => (window as unknown as { agentUi: { sent: unknown[] } }).agentUi.sent);
		assert.deepEqual(sent, [{ text: "Make it bigger", comments: [] }], "a line reaches the host's send");
		assert.ok(await page.locator(".ctx-ring").count(), "the context dial draws its ring");
		assert.deepEqual(errors, []);
	} finally {
		await browser.close();
		await server.close();
	}
});
