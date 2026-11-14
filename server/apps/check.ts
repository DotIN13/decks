import { Refused } from "../../protocol/index.ts";

// app.check: load the app in a browser and say what went wrong. Rule 12.
// The browser is Playwright's Chromium, started for the check and closed after.

export type Checked = { verdict: string; url: string; title?: string; errors: string[]; failed?: string[]; words?: number };
type Load = { status: number; title: string; words: number; errors: string[]; failed: string[] };

/** The verdict from what a load found, in a sentence. */
export function verdict(found: Load): string {
	if (found.status >= 400) return `The page answered ${found.status}.`;
	if (found.errors.length) return `The page threw ${found.errors.length} error${found.errors.length > 1 ? "s" : ""}.`;
	if (found.failed.length) return `${found.failed.length} request${found.failed.length > 1 ? "s" : ""} failed.`;
	if (found.words === 0) return "The page loaded but shows no words.";
	return "Loads clean: no errors, no failed requests.";
}

/** Open url (with its pass) in Chromium, wait for it to settle, and report. */
export async function checkInBrowser(url: string, shown: string): Promise<Checked> {
	const playwright = await import("playwright").catch(() => undefined);
	if (!playwright) throw new Refused("unavailable", "app.check needs Playwright's Chromium, and it is not installed here.", "app.logs");
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
		const errors: string[] = [];
		const failed: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message.split("\n")[0]!));
		page.on("console", (line) => void (line.type() === "error" && errors.push(line.text().slice(0, 300))));
		page.on("requestfailed", (request) => failed.push(`${request.url().replace(/[?&]pass=[^&]+/, "")} ${request.failure()?.errorText ?? ""}`.trim()));
		page.on("response", (answer) => void (answer.status() >= 400 && failed.push(`${answer.url().replace(/[?&]pass=[^&]+/, "")} ${answer.status()}`)));
		const answer = await page.goto(url, { waitUntil: "load", timeout: 30_000 }).catch((error: Error) => {
			errors.push(error.message.split("\n")[0]!);
			return null;
		});
		await page.waitForTimeout(500);
		const title = await page.title().catch(() => "");
		const text = String(await page.evaluate("document.body ? document.body.innerText : ''").catch(() => ""));
		const found: Load = { status: answer?.status() ?? 0, title, words: text.split(/\s+/).filter(Boolean).length, errors, failed };
		return { verdict: verdict(found), url: shown, ...(title ? { title } : {}), errors, ...(failed.length ? { failed } : {}), words: found.words };
	} finally {
		await browser.close();
	}
}
