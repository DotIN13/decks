import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cloneRepo, initRepo, isRepo, nameFromUrl, repoState, type RepoState } from "../apps/repo.ts";
import { STARTER_KIND, STARTERS, writeStarter, type Starter } from "../apps/starters.ts";
import type { AppKind } from "../apps/service.ts";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import type { VerbContext } from "./context.ts";

/** The item that shows an app on a canvas, as `canvas.insert` takes it (`verbs/canvas.ts`). */
const appItem = (name: string) => ({ type: "app" as const, app: name });

/** What to do with a new app before the item showing it is worth placing, by its kind. */
function nextSteps(name: string, kind: AppKind, first = "Edit the files"): string {
	const insert = `decks apps check ${name} and decks canvas insert '{"type":"app","app":"${name}"}'`;
	if (kind === "static") return `${first}, then ${insert}.`;
	if (kind === "build") return `${first}, decks apps build ${name}, then ${insert}.`;
	return `${first}, decks apps run ${name}, then ${insert}.`;
}

/** Apps: folders in the deck's apps/ that Decks serves, builds or runs. */
export function appsVerbs(ctx: VerbContext): Pick<Stage, "apps"> {
	const { service, agent } = ctx;
	return {
		/**
		 * Apps in the deck's `apps/` (`apps/service.ts`): an app is a folder the agent writes with its
		 * own tools, and these are what Decks does with it. Each answers at once or within fifteen
		 * seconds: an install can take minutes, and a stage run is abandoned after twenty, so a
		 * `pending` answer means ask `status` again on the next call.
		 *
		 * Agents' verbs: a board's own code may read the list and an app's state, nothing more.
		 */
		apps: (() => {
			const service_ = () => {
				const apps = service.apps;
				if (!apps) throw new Error("This server runs no apps.");
				return apps;
			};
			const agentOnly = (what: string) => {
				if (agent.board) throw new Error(`A board's own code cannot ${what} an app; ask an agent.`);
			};
			const known = (name: unknown) => {
				const apps = service_();
				const text = String(name ?? "").trim();
				if (!apps.exists(text)) throw new Error(`There is no app called ${JSON.stringify(text)}. decks apps list names them; decks apps create <name> --starter … makes one.`);
				return text;
			};
			/** Take every item showing an app off the deck's own canvases; answers them as `<canvas>/<id>`. */
			const takeOff = (name: string): string[] => {
				const pens = service.pens;
				if (!pens) return [];
				const gone: string[] = [];
				for (const canvas of pens.names()) {
					if (pens.isShared(canvas)) continue;
					const ids = (pens.get(canvas).doc.children ?? [])
						.filter((node) => node.type === "browser" && (node.metadata as { type?: unknown; name?: unknown } | undefined)?.type === "decks.app" && (node.metadata as { name?: unknown }).name === name)
						.map((node) => node.id);
					if (!ids.length) continue;
					pens.edit(canvas, ids.map((id) => ({ op: "delete" as const, id })));
					gone.push(...ids.map((id) => `${canvas}/${id}`));
				}
				return gone;
			};
			return {
				list: async () => service_().list(),
				status: async (name: string) => service_().state(known(name)),
				/**
				 * A new app from a starter, and the item that shows it (placing it is the canvas's job). `static` is files served as they
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
					// Its own repository from the start, so it can be pushed and shared; an app without one still works.
					let repo: { branch: string; head: string } | undefined;
					let unkept = "";
					try {
						const made = await initRepo(folder, `Start ${title} from the ${starter} starter`);
						repo = { branch: made.branch, head: made.head };
					} catch (error) {
						unkept = ` Its git repository was not made (${(error as Error).message}); decks apps repo ${text} tries again.`;
					}
					return {
						name: text,
						kind: STARTER_KIND[starter],
						folder: `apps/${text}`,
						files,
						item: appItem(text),
						url: `/app/${text}/`,
						...(repo ? { repo } : {}),
						next: nextSteps(text, STARTER_KIND[starter]) + unkept,
					};
				},
				/**
				 * The app's git repository: made now, with everything in it committed, if the folder is not
				 * one yet. Reading one that exists is anyone's; making one is an agent's or the person's.
				 */
				repo: async (name: string): Promise<RepoState> => {
					const text = known(name);
					const folder = service_().folder(text);
					if (!isRepo(folder)) {
						if (agent.board) throw new Error(`A board's own code cannot put an app in git; ask an agent.`);
						await initRepo(folder, `Keep ${text} in git`);
					}
					return repoState(folder);
				},
				/** An app taken in from a git address, and the item that shows it. Nothing is installed or run. */
				clone: async (url: string, options?: { name?: string; title?: string }) => {
					agentOnly("clone");
					const apps = service_();
					const address = String(url ?? "").trim();
					const text = options?.name?.trim() || nameFromUrl(address);
					if (!text) throw new Error(`No app name can be made from ${JSON.stringify(address)}; give one with --name.`);
					const folder = apps.folder(text);
					if (existsSync(folder)) throw new Error(`apps/${text} already exists; pick another name with --name.`);
					const cloned = await cloneRepo(address, folder);
					if (!apps.exists(text)) {
						rmSync(folder, { recursive: true, force: true });
						throw new Error(`${address} has no app.json at its top, so it is not a Decks app; nothing was kept.`);
					}
					let manifest;
					try {
						manifest = apps.manifest(text);
					} catch (error) {
						rmSync(folder, { recursive: true, force: true });
						throw error;
					}
					return {
						name: text,
						kind: manifest.kind,
						folder: `apps/${text}`,
						item: appItem(text),
						url: `/app/${text}/`,
						repo: { branch: cloned.branch, head: cloned.head, ...(cloned.remote ? { remote: cloned.remote } : {}) },
						next: nextSteps(text, manifest.kind, "Read its files first, since it is someone else's code"),
					};
				},
				/** The item that shows an app whose folder was written by hand; nothing is written. */
				item: async (name: string) => appItem(known(name)),
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
				/**
				 * Delete an app, from the person's ⋯ menu or an agent: stop it, move its folder to the deck's
				 * trash rather than erase it (a whole app is too much to lose to one press), and take the
				 * items that show it off the deck's own canvases, which would only show an app that is not
				 * there. A friend's canvas is theirs, and left alone.
				 */
				delete: async (name: string) => {
					agentOnly("delete");
					const apps = service_();
					const text = known(name);
					apps.stop(text);
					const stamp = new Date().toISOString().replace(/[:.]/g, "-");
					const trash = join(".decks", "trash", "apps", `${text}-${stamp}`);
					mkdirSync(join(service.deckPath(), ".decks", "trash", "apps"), { recursive: true });
					renameSync(apps.folder(text), join(service.deckPath(), trash));
					return { deleted: text, trash: trash.split("\\").join("/"), items: takeOff(text) };
				},
				logs: async (name: string, options?: { tail?: number }) => service_().log(known(name), options?.tail ?? 80),
				/** The app opened in the server's own browser: errors, failed requests and a picture, as `decks.canvas.fit` is for a board. */
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
