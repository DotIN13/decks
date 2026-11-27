// Small pictures a log entry can carry in its "viz" field, so a reader sees what a run did, not only
// that it ran. Each takes plain data and returns HTML (a string). Add your own kinds here.
//
//   { "type": "tally", "text": "the cat saw the dog", "top": 5 }        words being counted, then the count
//   { "type": "tests", "items": [{ "name": "apostrophe at a cut", "status": "fail" }, …] }   one block per test
//   { "type": "cloud", "words": [["the", 70], ["of", 40], …], "examples": ["a line of the text", …] }
//   { "type": "waterfall", "unit": "ms", "spans": [{ "label": "read", "start": 0, "dur": 120, "lane": "Counter" }, …] }
//   { "type": "bars", "unit": "ms", "items": [["Counter", 65], ["dict loop", 84]], "best": "low" }
//   { "type": "image", "src": "files/plot.png", "caption": "…" }

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const HUES = [210, 150, 30, 280, 350, 190, 100, 55];

export const vizCss = `
	.viz { box-sizing: border-box; max-width: 100%; min-width: 0; overflow: hidden; color: var(--b-fg); font-weight: 400; margin-top: 8px; border: 1px solid var(--b-border); border-radius: 8px; background: var(--b-bg); padding: 10px 12px; font-size: 14px }
	.viz .cap { color: var(--b-muted); margin-top: 6px }
	.viz .words { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px }
	.viz .w { padding: 1px 7px; border-radius: 5px; font-family: var(--b-mono); font-size: 14px }
	.viz .tally b { font-weight: 600 }
	.viz .tally { display: grid; grid-template-columns: max-content 1fr max-content; gap: 3px 8px; align-items: center }
	.viz .tally .bar { height: 8px; border-radius: 4px }
	.viz .blocks { display: flex; flex-wrap: wrap; gap: 3px }
	.viz .blocks i { width: 14px; height: 14px; border-radius: 3px; background: color-mix(in srgb, var(--b-ok) 70%, transparent) }
	.viz .blocks i.fail { background: var(--b-danger) } .viz .blocks i.skip { background: var(--b-border-strong) }
	.viz .failing { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px }
	.viz .failing li { display: flex; gap: 8px; align-items: baseline }
	.viz .failing li::before { content: ""; flex: none; width: 10px; height: 10px; border-radius: 2px; background: var(--b-danger); transform: translateY(1px) }
	.viz .failing small { color: var(--b-muted) }
	.viz .cloud { display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline; gap: 2px 10px; line-height: 1.1 }
	.viz .ex { margin-top: 8px; font-family: var(--b-mono); color: var(--b-muted); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
	.viz svg { display: block; width: 100%; height: auto; overflow: visible }
	.viz svg text { font: 14px var(--b-font); fill: var(--b-muted) }
	.viz svg .lab { fill: var(--b-fg) }
	.viz img { max-width: 100%; border-radius: 6px; display: block }
`;

function tally(v) {
	const words = String(v.text ?? "").toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
	const counts = new Map();
	for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
	const order = [...counts.keys()];
	const hue = (w) => HUES[order.indexOf(w) % HUES.length];
	const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, v.top ?? 5);
	const max = top[0]?.[1] ?? 1;
	return `<div class="words">${words.slice(0, 40).map((w) => `<span class="w" style="background:hsl(${hue(w)} 70% 50% / .16)">${esc(w)}</span>`).join("")}</div>
		<div class="tally">${top.map(([w, n]) => `<span class="w" style="background:hsl(${hue(w)} 70% 50% / .16)">${esc(w)}</span><span class="bar" style="width:${(100 * n) / max}%;background:hsl(${hue(w)} 65% 50%)"></span><b>${n}</b>`).join("")}</div>`;
}

function tests(v) {
	const items = v.items ?? [];
	const fails = items.filter((t) => t.status === "fail");
	const pass = items.filter((t) => t.status === "pass").length;
	return `<div class="blocks" title="${pass} pass, ${fails.length} fail">${items.map((t) => `<i class="${esc(t.status)}" title="${esc(t.name)}"></i>`).join("")}</div>
		${fails.length ? `<ul class="failing">${fails.map((t) => `<li><span>${esc(t.name)}${t.detail ? ` <small>${esc(t.detail)}</small>` : ""}</span></li>`).join("")}</ul>` : ""}
		<div class="cap">${pass} of ${items.length} pass</div>`;
}

function cloud(v) {
	const words = v.words ?? [];
	const max = Math.max(1, ...words.map((w) => w[1]));
	// Biggest in the middle reads as a cloud without a layout library.
	const sorted = [...words].sort((a, b) => b[1] - a[1]);
	const ring = [];
	sorted.forEach((w, i) => (i % 2 ? ring.push(w) : ring.unshift(w)));
	return `<div class="cloud">${ring.map(([w, n], i) => `<span style="font-size:${Math.round(14 + 22 * Math.sqrt(n / max))}px;font-weight:${n / max > 0.4 ? 650 : 450};color:hsl(${HUES[i % HUES.length]} 55% 45%)">${esc(w)}</span>`).join("")}</div>
		${(v.examples ?? []).map((e) => `<div class="ex">“${esc(e)}”</div>`).join("")}`;
}

function waterfall(v) {
	const spans = v.spans ?? [];
	const lanes = [...new Set(spans.map((s) => s.lane ?? ""))];
	const end = Math.max(1, ...spans.map((s) => s.start + s.dur));
	const L = 90, W = 560, R = 60, rowH = 22, laneGap = 10;
	let y = 4;
	const rows = [];
	for (const lane of lanes) {
		const mine = spans.filter((s) => (s.lane ?? "") === lane);
		rows.push(`<text class="lab" x="0" y="${y + 15}">${esc(lane)}</text>`);
		mine.forEach((s, i) => {
			const x = L + (W * s.start) / end, w = Math.max(2, (W * s.dur) / end);
			rows.push(`<rect x="${x}" y="${y}" width="${w}" height="${rowH - 6}" rx="3" fill="hsl(${HUES[i % HUES.length]} 60% 52%)" opacity=".85"><title>${esc(s.label)}: ${s.dur} ${esc(v.unit ?? "")}</title></rect>`);
			rows.push(`<text x="${x + w + 5}" y="${y + 12}">${esc(s.label)} ${s.dur}</text>`);
			y += rowH;
		});
		y += laneGap;
	}
	const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${L + W * f}" x2="${L + W * f}" y1="0" y2="${y - laneGap}" stroke="var(--b-border)" /><text x="${L + W * f}" y="${y + 6}" text-anchor="middle">${Math.round(end * f)}</text>`).join("");
	return `<svg viewBox="0 0 ${L + W + R} ${y + 12}">${ticks}${rows.join("")}</svg><div class="cap">time from the start, ${esc(v.unit ?? "")}</div>`;
}

function bars(v) {
	const items = v.items ?? [];
	const max = Math.max(1, ...items.map((i) => i[1]));
	const best = v.best === "high" ? Math.max(...items.map((i) => i[1])) : Math.min(...items.map((i) => i[1]));
	return `<div class="tally">${items.map(([l, n]) => `<span>${esc(l)}</span><span class="bar" style="width:${(100 * n) / max}%;background:${n === best ? "var(--b-accent)" : "var(--b-border-strong)"}"></span><b>${n} ${esc(v.unit ?? "")}</b>`).join("")}</div>`;
}

const KINDS = { tally, tests, cloud, waterfall, bars, image: (v) => `<img src="${esc(v.src)}" alt="" />` };

/** The picture for one entry's viz, or "" when it has none or the kind is unknown. */
export function vizHtml(v) {
	const draw = v && KINDS[v.type];
	if (!draw) return "";
	return `<div class="viz">${draw(v)}${v.caption ? `<div class="cap">${esc(v.caption)}</div>` : ""}</div>`;
}
