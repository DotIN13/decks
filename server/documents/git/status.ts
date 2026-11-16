// A repository's state as git prints it, read; a remote's address cleaned and named; a failed run said plainly.

export type DocRepo = { branch: string; upstream?: string; remote?: string; label?: string; ahead: number; behind: number; changed: number };
export type GitRun = { code: number | null; out: string };

/** `git status --porcelain=v2 --branch`, read (rule 2). */
export function readStatus(porcelain: string): DocRepo {
	const status: DocRepo = { branch: "", ahead: 0, behind: 0, changed: 0 };
	let oid = "";
	for (const line of porcelain.split("\n")) {
		if (line.startsWith("# branch.oid ")) oid = line.slice(13).trim();
		else if (line.startsWith("# branch.head ")) status.branch = line.slice(14).trim();
		else if (line.startsWith("# branch.upstream ")) status.upstream = line.slice(18).trim();
		else if (line.startsWith("# branch.ab ")) {
			const [, ahead, behind] = /\+(\d+) -(\d+)/.exec(line) ?? [];
			status.ahead = Number(ahead ?? 0);
			status.behind = Number(behind ?? 0);
		} else if (/^[12u] /.test(line)) status.changed++;
	}
	if (status.branch === "(detached)" || status.branch === "") status.branch = oid === "(initial)" || !oid ? "no commits" : oid.slice(0, 7);
	return status;
}

/** An address with any user, token or password taken out, safe to show (rule 3). */
export function cleanRemote(url: string): string {
	return url.replace(/^(\w+:\/\/)[^@/]*@/, "$1");
}

/** What to call a remote: Overleaf for an Overleaf project, else its host (rule 3). */
export function remoteLabel(url: string): string | undefined {
	if (/(^|[./@])overleaf\.com\b/i.test(url)) return "Overleaf";
	return /^\w+:\/\/(?:[^@/]*@)?([^/:]+)/.exec(url)?.[1] ?? /^[^@]+@([^:]+):/.exec(url)?.[1];
}

/** A sentence for a failed run: the reasons people meet, said plainly, else git's own last line (rule 9). */
export function why(run: GitRun, label: string): string {
	const out = run.out;
	if (/could not read (Username|Password)|Authentication failed|terminal prompts disabled|Permission denied \(publickey/i.test(out))
		return label === "Overleaf"
			? "Overleaf asked for a login. Make a Git token in Overleaf (Account settings, Git integration) and put it in the remote: https://git:TOKEN@git.overleaf.com/PROJECT."
			: `${label} asked for a login this server does not have. Give the repository a token in its remote address, or a credential helper.`;
	if (/Could not resolve host|unable to access|Connection (timed out|refused)|does not appear to be a git repository/i.test(out)) return `${label} could not be reached.`;
	const last = out.trim().split("\n").filter((line) => line.trim()).pop() ?? "";
	return last.replace(/^(fatal|error): /, "") || `git stopped (exit ${run.code}).`;
}

export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "Overleaf" as the start of a sentence: its first letter capital. */
export const capital = (text: string) => `${text[0]!.toUpperCase()}${text.slice(1)}`;
