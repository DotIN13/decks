import { STARTER_KIND, STARTERS, writeStarter, type Starter } from "../apps/starters.ts";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import type { VerbContext } from "./context.ts";

/** Apps: folders in the deck's apps/ that Decks serves, builds or runs. */
export function appsVerbs(ctx: VerbContext): Pick<Stage, "apps"> {
	const { service, agent, isolated, notWhileIsolated } = ctx;
	return {
		/**
		 * Apps in the deck's `apps/` (`apps/service.ts`): an app is a folder the agent writes with its
		 * own tools, and these are what Decks does with it. Each answers at once or within fifteen
		 * seconds: an install can take minutes, and a stage run is abandoned after twenty, so a
		 * `pending` answer means ask `status` again on the next call.
		 *
		 * Agents' verbs: a board's own code may read the list and an app's state, nothing more, and an
		 * isolated agent may not use them, since an app's server reaches outside its stage.
		 */
		apps: (() => {
			const service_ = () => {
				const apps = service.apps;
				if (!apps) throw new Error("This server runs no apps.");
				return apps;
			};
			const agentOnly = (what: string) => {
				if (isolated()) notWhileIsolated(`apps (${what})`);
				if (agent.board) throw new Error(`A board's own code cannot ${what} an app; ask an agent.`);
			};
			const known = (name: unknown) => {
				const apps = service_();
				const text = String(name ?? "").trim();
				if (!apps.exists(text)) throw new Error(`There is no app called ${JSON.stringify(text)}. decks apps list names them; decks apps create <name> --starter … makes one.`);
				return text;
			};
			return {
				list: async () => service_().list(),
				status: async (name: string) => service_().state(known(name)),
				/**
				 * A new app from a starter, and the board that shows it. `static` is files served as they
				 * are; `node` a server with no packages; `solid` and `react` built with Vite; `next` a
				 * Next.js server. Take the lowest that does the job.
				 */
				create: async (name: string, options?: { starter?: string; title?: string }) => {
					agentOnly("make");
					const apps = service_();
					const text = String(name ?? "").trim();
					const folder = apps.folder(text);
					if (apps.exists(text)) throw new Error(`apps/${text} already exists; edit its files, or pick another name.`);
					const starter = (options?.starter ?? "static") as Starter;
					if (!STARTERS.includes(starter)) throw new Error(`Unknown starter ${JSON.stringify(options?.starter)}; one of ${STARTERS.join(", ")}.`);
					const title = options?.title?.trim() || text;
					const files = writeStarter(folder, starter, title);
					const board = service.appBoard(text, title);
					return {
						name: text,
						kind: STARTER_KIND[starter],
						folder: `apps/${text}`,
						files,
						board,
						url: `/app/${text}/`,
						next: STARTER_KIND[starter] === "static" ? `Edit the files, then decks apps check ${text} and decks show ${board}.` : STARTER_KIND[starter] === "build" ? `Edit the files, decks apps build ${text}, then decks apps check ${text} and decks show ${board}.` : `Edit the files, decks apps run ${text}, then decks apps check ${text} and decks show ${board}.`,
					};
				},
				/** The board for an app whose folder was written by hand. */
				board: async (name: string) => {
					const text = known(name);
					return service.appBoard(text, service_().state(text).title);
				},
				build: async (name: string) => {
					agentOnly("build");
					return service_().build(known(name));
				},
				run: async (name: string) => {
					agentOnly("run");
					return service_().run(known(name));
				},
				stop: async (name: string) => {
					agentOnly("stop");
					return { stopped: service_().stop(known(name)) };
				},
				/** Stop and start a server app, after its code changed; a built app is built again. The board reloads when it is back. */
				restart: async (name: string) => {
					agentOnly("restart");
					const text = known(name);
					service_().stop(text);
					return service_().run(text);
				},
				logs: async (name: string, options?: { tail?: number }) => service_().log(known(name), options?.tail ?? 80),
				/** The app opened in the server's own browser: errors, failed requests and a picture, as `fit` is for a board. */
				check: async (name: string) => {
					agentOnly("check");
					const text = known(name);
					if (!service.appCheck) throw new Error("This server has no browser to check an app with.");
					const kind = service_().state(text).kind;
					if (kind !== "static") {
						const ready = kind === "server" ? await service_().run(text, 6_000) : service_().state(text).status === "running" ? undefined : await service_().build(text, 6_000);
						if (ready && !ready.ok) return { verdict: ready.pending ? `apps/${text} is still ${ready.status}; check again in a moment.` : `apps/${text} is ${ready.status}: ${ready.errors.at(-1) ?? `see decks apps logs ${text}`}`, ...ready };
					}
					return service.appCheck(text);
				},
			};
		})(),
	};
}
