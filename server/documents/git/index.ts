import { calls, type Handled } from "../../../protocol/index.ts";
import { handleAll, type Context, type Kernel } from "../../kernel/types.ts";
import { Repos } from "./repo.ts";

// The git part of the documents feature: file.repo, file.pull, file.push.

export { cleanRemote, readStatus, remoteLabel } from "./status.ts";

/** The handlers; machine is read at call time, since the kernel arrives at start (rule 13). */
export function gitCalls(machine: () => Kernel["run"]): Handled<Context>[] {
	const repos = new Repos(machine);
	const { repo, pull, push } = calls.file;
	return handleAll(
		{ repo, pull, push },
		{
			repo: async (_ctx, { path }) => repos.repo(path),
			pull: async (_ctx, { path }) => repos.pull(path),
			push: async (_ctx, { path }) => repos.push(path),
		},
	);
}
