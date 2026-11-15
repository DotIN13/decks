// The switch-over plan as Markdown: what run.mjs --dry prints and writes to docs/rewrite/switch-plan.md.

import { KEPT_FILES } from "./plan.mjs";

const list = (rows) => rows.map((r) => `- ${r}`).join("\n");

function deleted(p) {
	const go = p.deletions.filter((d) => d.delete).map((d) => `\`${d.old}\` (${d.name ?? "no package"}): now ${d.home}. Proof: ${d.proof}.${Object.entries(d.keep ?? {}).map(([f, why]) => ` **Except \`${f}\`, kept where it is:** ${why}.`).join("")}`);
	const moved = p.deletions.filter((d) => d.why === "already gone").map((d) => `\`${d.old}\`: already moved to ${d.home}.`);
	const stay = p.deletions.filter((d) => !d.delete && d.why !== "already gone").map((d) => `\`${d.old}\`: **not deleted**, ${d.why}. Its new home: ${d.home}.`);
	return `## Deleted\n\n${list([...go, ...moved])}\n\n### Not deleted, and why\n\n${list(stay)}\n- \`packages/docs\`: its server half lives in server/documents, its page half is Loom's; the package goes whole with Loom.`;
}

function kept(p) {
	const files = Object.entries(KEPT_FILES).map(([f, why]) => `\`${f}\`: ${why}`);
	const why = { "packages/protocol": "the canvas library reads its old shapes (Page, Presence and the old call and author types)", "packages/api": "the canvas library's card calls (cardCalls)", "packages/hub": "the canvas library's follower (studio-line.ts)" };
	return `## Kept until Loom moves them (wave 3)\n\nDecided in DESIGN.md section 11; they go at the map's step 4a.\n\n${list([...p.kept.map((k) => `\`${k}\`${why[k] ? `: ${why[k]}` : ""}`), ...files, "`runtime/live-doc.ts`: see Deleted"])}`;
}

function renamed(p) {
	const rows = p.renames.map((r) => `\`${r.from}\` to \`${r.to}\` (${r.dir}): ${r.files} file(s) name it`);
	const clash = p.clashes.map((c) => `\`${c.dir}\` (\`${c.name}\`) is a kept package whose name a new one takes: first it becomes \`${c.to}\` until Loom moves it (map step 4a), and its ${c.files.length} importers get that specifier, nothing else in them changed: ${c.files.join(", ")}`);
	return `## Renamed\n\nAfter the deletions, so no new name meets a deleted package's:\n\n${list(rows)}${clash.length ? `\n\nTwo workspaces cannot share a name:\n\n${list(clash)}` : ""}\n\nThen one install under the heavy lock, so node_modules links the new names.`;
}

function moved(p) {
	const by = new Map();
	for (const m of p.checks.moved) {
		const dir = m.to.replace(/\/[^/]+$/, "");
		const tag = [m.stop3 ? "" : "not in stop 3", m.owned || !m.stop3 ? "" : `by subject: ${m.owner}`, m.traits.timed ? "timed" : "", m.traits.named ? "named" : ""].filter(Boolean).join(", ");
		by.set(dir, [...(by.get(dir) ?? []), m.check + (tag ? ` (${tag})` : "")]);
	}
	const rows = [...by].map(([dir, checks]) => `\`${dir}/\` (${checks.length}): ${checks.join(", ")}`);
	const fake = p.checks.moved.filter((m) => m.traits.agent && !m.traits.model).map((m) => m.check);
	const real = p.checks.moved.filter((m) => m.traits.model).map((m) => m.check);
	return `## Moved\n\nAll ${p.checks.moved.length} browser checks move and start under \`node tools/checks/run.mjs\`; \`e2e/run.mjs\` goes with e2e/. Stop 3's go to their owners' features (owners from the stop 3 card's runs.json; with none, by what they exercise: the page's to Pane, the canvas library's to tools/checks/canvas until Loom moves the library); the agent checks to tools/checks/agent, the benches to tools/checks/bench:\n\n${list(rows)}\n\nWhat the runner must know of a check is a field in \`tools/checks/checks.json\`: \`timed\` runs alone on the dev server, as it was written for (DESIGN.md section 11), every other check on the built page; \`agent\` is skipped unless \`--agent\`; \`named\` and \`bench\` for the long checks and the measures; \`path\` where it lives. \`e2e/harness.mjs\` becomes \`tools/checks/harness.mjs\` and each moved check's \`../\` imports point there; the fake model and agent move to tools/checks; the fixture is \`tools/fixtures/deck\` (already there).\n\n### The agent checks, once on the new programs before the deletions\n\n${fake.join(", ")}: each starts an agent's turn through Pi with the fake model (\`fake-agent\`, \`fake-model.mjs\` on port 4700), which the runner starts; no signed-in Claude, no tokens. Run on 2026-11-14: all pass. ${real.join(", ")}: asks the agent to run the decks command, which the fake model cannot do; it needs a real model. The runner starts the harness with Pi on the fake model only, so that run needs the harness started with a signed-in Claude (\`--kinds claude\`), once, with Mason's yes.`;
}

function compat(names) {
	const spoken = names.filter((n) => n.spoken);
	const quiet = names.filter((n) => !n.spoken);
	return `## Compat\n\nEvery old name answers until ${names[0]?.goes ?? "GOES"}. After the switch, today's canvas library (kept until Loom), the page's compat mode and the moved checks still speak ${spoken.length} of the ${names.length} renamed names; those stay, and Studio and the iPad app may speak any of them until the date. ${quiet.length} are spoken by nothing in this repo; they could go now, but stay until ${names[0]?.goes} for Studio and the iPad app, which are not in this repo:\n\n${list(quiet.map((n) => `\`${n.old}\` (${n.kind}) -> \`${n.now}\``))}`;
}

function root(r) {
	const kept = Object.entries(r.kept).map(([k, why]) => `\`${k}\` (${why})`).join("; ");
	return `## Root files\n\n- Workspaces: ${r.workspaces.map((w) => `\`${w}\``).join(", ")}.\n- Kept until Loom moves the packages that use them: ${kept}.\n- Scripts: ${Object.entries(r.scripts).map(([k, v]) => `\`${k}\`: \`${v}\``).join("; ")}.\n- Scripts removed: ${r.removedScripts.map((s) => `\`${s}\``).join(", ")}.\n- CI: ${r.ci}.`;
}

function lanes(l) {
	const rows = [["1. moving the checks", l.move], ["2. deleting", l.delete], ["3. renaming (files that name @decks-next)", l.rename], ["4. root files and CI", l.root]];
	return `## Lanes the switch needs, for that one job\n\n${list(rows.map(([what, paths]) => `${what}: ${paths.map((x) => `\`${x}\``).join(", ")}`))}`;
}

export function render(p, names, r, l) {
	return `# The switch-over, planned\n\nWritten by \`node tools/switch/run.mjs --dry\` on ${new Date().toISOString().slice(0, 10)} from the tree as it is. Nothing in any deck is touched; "apps" means the repo's apps/ source folder.\n\n${[deleted(p), kept(p), renamed(p), moved(p), compat(names), root(r), ...(l ? [lanes(l)] : [])].join("\n\n")}\n\n## Order, one commit each, the gates passing after each\n\nThe commits touch other lanes' folders: Mason opens the paths listed above to Warden for the switch.\n\n1. Move every check, the harness and the fake model and agent into place; run.mjs finds them by checks.json.\n2. Delete what has a new home and no importer left.\n3. Rename @decks-next to @decks, then install.\n4. Root files and CI.\n5. Shrink the gate baselines.\n`;
}
