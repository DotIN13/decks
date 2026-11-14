import { readFileSync } from "node:fs";
import { CALLS, CALL_BY_NAME, EVENTS } from "../../protocol/index.ts";
import { ROOT } from "./paths.ts";

// Proves docs/rewrite/calls.md is whole: every name in today's three files
// appears exactly once, every declared call and event appears, and each
// call's Who column says what its declaration says. Exits 1 on a problem.

type From = "agents" | "person" | "event";
type Row = { from: From; old: string; now: string };

/** Today's names, read from the old files while they exist. */
export async function oldNames(): Promise<Record<From, string[]>> {
	const api = `${ROOT}/packages/api/src`;
	const agents = (await import(`${api}/verbs.ts`)).VERBS as { name: string }[];
	const person = (await import(`${api}/person.ts`)).PERSON_VERBS as { name: string }[];
	const events = (await import(`${ROOT}/packages/protocol/src/names.ts`)).EVENTS as string[];
	return { agents: agents.map((v) => v.name), person: person.map((v) => v.name), event: events };
}

const cells = (line: string) => line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
const code = (cell: string) => /`([^`]+)`/.exec(cell)?.[1];

/** The rows of calls.md, and each call row's Who cell. */
export function parseTable(text: string): { rows: Row[]; news: string[]; who: Map<string, string[]> } {
	const rows: Row[] = [];
	const news: string[] = [];
	const who = new Map<string, string[]>();
	let section = "";
	for (const line of text.split("\n")) {
		if (line.startsWith("## ")) section = line.slice(3);
		if (!line.startsWith("| `") && !line.startsWith("| new")) continue;
		const c = cells(line);
		const events = section.startsWith("Events");
		const dropped = section.endsWith("dropped");
		const old = c[0] === "new" ? undefined : code(c[0] ?? "");
		const now = dropped ? "" : (code((events ? c[1] : c[2]) ?? "") ?? "");
		if (old) rows.push({ from: events ? "event" : (c[1] as From), old, now });
		if (now) news.push(now);
		if (now && !events) who.set(now, [...(who.get(now) ?? []), c[3] ?? ""]);
	}
	return { rows, news, who };
}

const whoCell = (names: readonly string[]) => (names.length === 4 ? "anyone" : names.join(", "));

export function problemsIn(text: string, old: Record<From, string[]>): string[] {
	const { rows, news, who } = parseTable(text);
	const problems: string[] = [];
	for (const from of ["agents", "person", "event"] as const) {
		for (const name of old[from]) {
			const n = rows.filter((r) => r.from === from && r.old === name).length;
			if (n !== 1) problems.push(`${from} ${name} appears ${n} times, not once.`);
		}
		for (const r of rows.filter((r) => r.from === from && !old[from].includes(r.old))) problems.push(`${from} ${r.old} is not a name of today.`);
	}
	const declared = new Set([...CALLS.map((c) => c.name), ...EVENTS.map((e) => e.name)]);
	for (const name of declared) if (!news.includes(name)) problems.push(`${name} is declared but not in the table.`);
	for (const name of news) if (!declared.has(name)) problems.push(`${name} is in the table but not declared.`);
	for (const [name, cellsOf] of who) {
		const call = CALL_BY_NAME.get(name);
		if (call && cellsOf.some((c) => c !== whoCell(call.who))) problems.push(`${name}: the Who column differs from its declaration.`);
	}
	return problems;
}

if (import.meta.main) {
	const text = readFileSync(`${ROOT}/docs/rewrite/calls.md`, "utf8");
	const old = await oldNames();
	const problems = problemsIn(text, old);
	for (const p of problems) console.error(p);
	const counts = `${old.agents.length} agents' calls, ${old.person.length} person's calls, ${old.event.length} events`;
	console.log(problems.length ? `calls.md is not whole: ${problems.length} problems.` : `calls.md is whole: ${counts}, each once; ${CALLS.length} calls and ${EVENTS.length} events declared, each in the table.`);
	process.exit(problems.length ? 1 : 0);
}
