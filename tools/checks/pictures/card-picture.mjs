/**
 * A card's picture, shown once zoomed out, looks like the card itself: card.css, its theme's --b-*
 * tokens and fonts are in it. Its page imports them by relative addresses, once refused for want of
 * a pass, which drew it unstyled, serif, with blocks black (server/pictures, 4117abd0).
 */
import { API, asPerson, card, canvasFrame, flyToCard, open, say, settle } from "../harness.mjs";

// The fixture's risks card: the theme's tokens, a table and code.
const PATH = card("risks");
const { browser, page, errors } = await open({ width: 1400, height: 1000, scheme: "light", cards: true });
await settle(page, 900);
await flyToCard(page, PATH);
const frame = await canvasFrame(page);
const live = frame.locator(`.card-node[data-path="${PATH}"]`).first();
const liveShot = await live.screenshot().catch(() => null);
say("the card is live on the canvas", !!liveShot);

const person = await asPerson();
const answer = await fetch(`${API}/api/thumb/${PATH}?w=480&scheme=light`, { headers: person });
const picture = Buffer.from(await answer.arrayBuffer());
say("the server pictures the card", answer.ok && picture.length > 2000, `${answer.status} ${answer.headers.get("content-type")} ${picture.length} bytes`);

/** Each image drawn 240 wide over the height both have; their mean difference and their share of near-black pixels. */
const compared = liveShot && answer.ok ? await page.evaluate(async ({ a, b }) => {
	const load = async (data, type) => createImageBitmap(await (await fetch(`data:${type};base64,${data}`)).blob());
	const [one, two] = [await load(a, "image/png"), await load(b, "image/jpeg")];
	const W = 240;
	const H = Math.floor(Math.min((one.height * W) / one.width, (two.height * W) / two.width));
	const pixels = (image) => {
		const g = new OffscreenCanvas(W, H).getContext("2d");
		g.drawImage(image, 0, 0, W, (image.height * W) / image.width);
		return g.getImageData(0, 0, W, H).data;
	};
	const [p, q] = [pixels(one), pixels(two)];
	let diff = 0, darkLive = 0, darkPicture = 0;
	for (let i = 0; i < p.length; i += 4) {
		diff += (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2])) / 3;
		if (p[i] + p[i + 1] + p[i + 2] < 120) darkLive++;
		if (q[i] + q[i + 1] + q[i + 2] < 120) darkPicture++;
	}
	const n = p.length / 4;
	return { mean: diff / n, darkLive: darkLive / n, darkPicture: darkPicture / n, size: [W, H] };
}, { a: liveShot.toString("base64"), b: picture.toString("base64") }) : undefined;
const said = JSON.stringify(compared && { mean: +compared.mean.toFixed(1), darkLive: +compared.darkLive.toFixed(3), darkPicture: +compared.darkPicture.toFixed(3), size: compared.size });
say("the picture looks like the live card: on average within 40 of 255 a channel", !!compared && compared.mean < 40, said);
say("…and no block of it is black that is not black live", !!compared && compared.darkPicture - compared.darkLive < 0.05, said);

say("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
