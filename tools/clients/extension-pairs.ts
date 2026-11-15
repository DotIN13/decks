import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { testServer } from "../../server/kernel/testing.ts";
import { tabFeature } from "../../server/tab/feature.ts";

// The real extension pairs with server/tab: Chromium loads clients/extension
// unpacked, the worker pairs with a code from tab.pair and shares a tab, and
// the server's tab.status and tab.read see it. A browser job: run it as
//   node tools/heavy.mjs --class check -- node --import tsx tools/clients/extension-pairs.ts

const EXTENSION = fileURLToPath(new URL("../../clients/extension", import.meta.url));
const say = (line: string) => console.log(line);

async function main(): Promise<number> {
	const server = await testServer({ features: [tabFeature()] });
	const doors = await server.listen(4606);
	const profile = mkdtempSync(`${tmpdir()}/decks-extension-`);
	// Full Chromium in its new headless mode: the headless shell loads no extension.
	const context = await chromium.launchPersistentContext(profile, {
		channel: "chromium",
		headless: true,
		args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
	});
	try {
		const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
		const { code } = await server.value<{ code: string }>("tab.pair", {});
		const page = await context.newPage();
		await page.goto(`${doors.url}/api/v1`);
		const paired = await worker.evaluate(([url, c]) => (globalThis as any).__decks.pair(url, c), [doors.url, code] as const);
		say(`paired: ${JSON.stringify(paired)}`);
		const tabId = await worker.evaluate(async () => (await (globalThis as any).chrome.tabs.query({ url: "http://127.0.0.1/*" }))[0]?.id);
		const shared = (await worker.evaluate((id) => (globalThis as any).__decks.share(id), tabId)) as { connected: boolean };
		say(`shared: ${JSON.stringify(shared)}`);
		const status = await server.value<{ connected: boolean; url?: string }>("tab.status", {});
		say(`tab.status: ${JSON.stringify(status)}`);
		const read = await server.value<{ url: string; snapshot: string }>("tab.read", {});
		say(`tab.read: ${read.url}, ${read.snapshot.length} characters`);
		await server.value("tab.stop", {});
		const ok = shared.connected && status.connected && read.url.startsWith(doors.url);
		say(ok ? "PASS: the real extension pairs with server/tab" : "FAIL: the real extension did not pair");
		return ok ? 0 : 1;
	} finally {
		await context.close();
		rmSync(profile, { recursive: true, force: true });
		await doors.close();
		await server.close();
	}
}

main().then(
	(code) => process.exit(code),
	(error: Error) => {
		console.error(`FAIL: ${error.message}`);
		process.exit(1);
	},
);
