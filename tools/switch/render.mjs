// The switch-over plan as Markdown: what run.mjs --dry prints and writes to docs/rewrite/switch-plan.md.

const list = (rows) => rows.map((r) => `- ${r}`).join("\n");

function deleted(p) {
	const go = p.deletions.filter((d) => d.delete).map((d) => `\`${d.old}\` (${d.name ?? "no package"}): now ${d.home}. Proof: ${d.proof}.`);
	const stay = p.deletions.filter((d) => !d.delete).map((d) => `\`${d.old}\`: **not deleted**, ${d.why}. Its new home: ${d.home}.`);
	return `## Deleted\n\n${list(go)}\n\n### Not deleted, and why\n\n${list(stay)}\n- \`packages/docs\`: its server half lives in server/documents, its page half is Loom's; the package goes whole with Loom.`;
}

function kept(p) {
	return `## Kept until Loom moves them (wave 3)\n\n${list(p.kept.map((k) => `\`${k}\``))}`;
}

function renamed(p) {
	const rows = p.renames.map((r) => `\`${r.from}\` to \`${r.to}\` (${r.dir}): ${r.files} file(s) name it`);
	return `## Renamed\n\nAfter the deletions, so no new name meets an old package's:\n\n${list(rows)}\n\nThen one install under the heavy lock, so node_modules links the new names.`;
}

function moved(p) {
	const by = new Map();
	for (const m of p.checks.moved) by.set(m.to.replace(/\/[^/]+$/, ""), [...(by.get(m.to.replace(/\/[^/]+$/, "")) ?? []), m.check + (m.owned ? "" : ` (by subject: ${m.owner})`)]);
	const rows = [...by].map(([dir, checks]) => `\`${dir}/\` (${checks.length}): ${checks.join(", ")}`);
	return `## Moved\n\nThe ${p.checks.moved.length} browser checks of stop 3, each to its owner's feature (owners from the stop 3 card's runs.json; with none, by what it exercises: the page's to Pane, the canvas library's to tools/checks/canvas until Loom moves the library):\n\n${list(rows)}\n\n\`e2e/harness.mjs\` becomes \`tools/checks/harness.mjs\`; each moved check's \`../harness.mjs\` import is rewritten to it, and nothing else in a check changes. \`e2e/run.mjs\` is replaced by \`tools/checks/run.mjs\`, which finds checks in their new places. The fixture moves from \`e2e/fixture\` to \`tools/fixtures/deck\` (already there).\n\n### Not in stop 3 (${p.checks.left.length}): they stay in e2e/checks with today's e2e/run.mjs, for their owners to keep or drop\n\n${p.checks.left.join(", ")}`;
}

function compat(names) {
	const spoken = names.filter((n) => n.spoken);
	const quiet = names.filter((n) => !n.spoken);
	return `## Compat\n\nEvery old name answers until ${names[0]?.goes ?? "GOES"}. After the switch, today's canvas library (kept until Loom), the page's compat mode and the moved checks still speak ${spoken.length} of the ${names.length} renamed names; those stay, and Studio and the iPad app may speak any of them until the date. ${quiet.length} are spoken by nothing in this repo; they could go now, but stay until ${names[0]?.goes} for Studio and the iPad app, which are not in this repo:\n\n${list(quiet.map((n) => `\`${n.old}\` (${n.kind}) -> \`${n.now}\``))}`;
}

function root(r) {
	return `## Root files\n\n- Workspaces: ${r.workspaces.map((w) => `\`${w}\``).join(", ")}.\n- Scripts: ${Object.entries(r.scripts).map(([k, v]) => `\`${k}\`: \`${v}\``).join("; ")}.\n- Scripts removed: ${r.removedScripts.map((s) => `\`${s}\``).join(", ")}.\n- CI: ${r.ci}.`;
}

export function render(p, names, r) {
	return `# The switch-over, planned\n\nWritten by \`node tools/switch/run.mjs --dry\` on ${new Date().toISOString().slice(0, 10)} from the tree as it is. Nothing in any deck is touched; "apps" means the repo's apps/ source folder.\n\n${[deleted(p), kept(p), renamed(p), moved(p), compat(names), root(r)].join("\n\n")}\n\n## Order, one commit each, the gates passing after each\n\nThe commits touch other lanes' folders (the moved checks, the deleted code): Mason opens those paths to Warden for the switch, or commits them.\n\n1. Move the 76 checks and the harness into place; run.mjs finds them there.\n2. Delete what has a new home and no importer left.\n3. Rename @decks-next to @decks, then install.\n4. Root files and CI.\n5. Shrink the gate baselines.\n`;
}
