import { existsSync } from "node:fs";
import type { Camera } from "@decks/protocol";
import { imageKind, imageSize, type ShotFormat, type ShotOf } from "../stage/shots.ts";
import { withBox } from "./context.ts";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import type { VerbContext } from "./context.ts";

/** Your stage and your view of it: what is up and where, the camera, cursors, and pictures of it. */
export function stageVerbs(ctx: VerbContext): Pick<Stage, "show" | "hide" | "move" | "camera" | "reload" | "cursor" | "viewport" | "screenshot"> {
	const { service, agent, images, asList, viewport, needStage, itemBox, isolated, here, cornerOf, reportPlace, notWhileIsolated } = ctx;
	return {
		/**
		 * Put these boards on this agent's stage, beside what is already there — or look at a
		 * **drawn item**, by its id in `stage.pen`.
		 *
		 * Added to, never narrowed: taking a board off is `hide`. The camera fits what was named,
		 * and anything not already held is held from now on — showing a board is working on it. An
		 * item is not held, because it is part of the stage already; naming one is only "look at
		 * this", and naming an item and a board together frames both.
		 *
		 * `animate: true` makes the camera **arrive** rather than jump — 420ms, easing out. It is off
		 * by default: an op states where to look, and something watching the camera a frame later
		 * should see what was asked for. The board's own links and the panel glide without being
		 * asked, because those are a person's hands.
		 */
		show: async (target: string | string[], options?: { fit?: "board" | "all"; highlight?: string; animate?: boolean; at?: { x1: number; y1: number } }) => {
			const wanted = asList(target);
			const named = cornerOf(options?.at);
			if (named && wanted.length !== 1) throw new Error("at places one board: show them one at a time, each with its own at.");
			const paths: string[] = [];
			const items: Array<{ id: string; box: { x: number; y: number; w: number; h: number } }> = [];
			for (const one of wanted) {
				if (here().some((board) => board.path === one)) {
					paths.push(one);
					continue;
				}
				const box = itemBox(one);
				if (!box && isolated()) notWhileIsolated(`showing ${one}, which is not on this stage,`);
				if (!box) throw new Error(`No such board or drawn item: ${one}`);
				items.push({ id: one, box });
			}
			const up = agent.inPlay();
			const joining = paths.filter((one) => !up.includes(one));
			const had = agent.positions?.() ?? {};
			const [one] = paths;
			if (named && one !== undefined && up.includes(one)) {
				// Already on the stage: a place named for it is a move.
				service.move(agent.id, one, named);
				agent.acted?.("move", one);
			}
			agent.setInPlay([...up, ...joining], named && one !== undefined && joining.includes(one) ? { [one]: named } : undefined);
			for (const path of joining) reportPlace(path, named, had[path]);
			// One board named is the focusing gesture: "look at what I made". Several is arranging
			// the canvas, and is nobody's byline. A drawn item is neither: it is already on the
			// stage, and looking at it is not authorship of anything.
			const [only] = paths;
			if (only !== undefined && wanted.length === 1) agent.worked?.(only);
			for (const one of paths) agent.acted?.("show", one);
			const { at: _at, ...showing } = options ?? {};
			return service.show(agent.id, paths, { ...showing, ...(items.length > 0 ? { items } : {}) });
		},
		/** Take boards off this agent's stage, keeping them in context. */
		hide: async (path: string | string[]) => {
			const dropping = new Set(asList(path));
			const up = agent.inPlay();
			const left = up.filter((playing) => !dropping.has(playing));
			agent.setInPlay(left);
			for (const one of dropping) if (up.includes(one)) agent.acted?.("hide", one);
		},
		move: async (path: string, at: { x: number; y: number }) => {
			const board = service.move(agent.id, path, at);
			agent.acted?.("move", board.path);
			return withBox(board);
		},
		camera: (async (at?: Camera, options?: { animate?: boolean }) => {
			if (!at) return agent.camera();
			await service.setCamera(agent.id, at, options ?? {});
			return undefined;
		}) as {
			(): Promise<Camera>;
			(at: Camera, options?: { animate?: boolean }): Promise<void>;
		},
		reload: async (path: string) => service.reload(agent.id, path),
		cursor: async (path: string, at: { x: number; y: number } | null) =>
			service.cursor(agent.id, path, at, agent.identity().name, agent.identity().color),

		/**
		 * How much room the canvas has, in CSS pixels — the window minus the chrome standing
		 * beside it, not divided by the zoom.
		 *
		 * `undefined` when nobody is looking, or before the first reading. There is no default
		 * on purpose: a made-up number is indistinguishable from a measured one at the point
		 * it is used, and a board sized against a fiction is worse than a board sized against
		 * your own judgement.
		 */
		// `null`, not nothing, when no browser has reported one: the answer travels as JSON.
		viewport: async () => viewport() ?? null,

		/**
		 * A picture of your stage, or of part of it, as the person sees it: the drawing and the live
		 * boards together. Attached to this call's result so you see it at once, and saved to `file`.
		 * `of` is an item's id, a board's path, a list of them, or a box; nothing is the whole stage.
		 * `to` saves it where you say instead, and `format: "pdf"` or `"jpeg"` for other kinds.
		 */
		screenshot: async (options?: { of?: ShotOf; scale?: number; format?: ShotFormat; to?: string; scheme?: "light" | "dark"; live?: boolean }) => {
			if (!service.shots) throw new Error("This server cannot take pictures of a stage.");
			const { of, scale, format, to, scheme, live } = options ?? {};
			/*
			 * One board, by its path: as the person's browser has it now, so the picture shows what
			 * they did on the page — drawn there by HTML-in-Canvas when it can be, from a snapshot of
			 * the page otherwise. With no live page to draw, the server's picture from the file, and
			 * the answer says it does not show their interaction.
			 */
			if (typeof of === "string" && format !== "pdf" && here().some((board) => board.path === of)) {
				const seen = await service.seenBoard(agent.id, of);
				let bytes: Buffer;
				let mime: string;
				let note: string;
				if (seen.how !== "none") {
					bytes = seen.bytes;
					mime = seen.mime;
					note = seen.how === "canvas" ? "As the person's browser shows it now, drawn there by HTML-in-Canvas: it includes what they did on the page." : "As the person's browser has it now, from a snapshot of the page: it includes what they did on the page, such as tabs pressed, text typed and boxes scrolled.";
				} else {
					if (!service.boardPicture) throw new Error("This server cannot take pictures of a board.");
					bytes = await service.boardPicture(of, scheme === "dark" ? "dark" : "light");
					mime = imageKind(bytes)?.mime ?? "image/jpeg";
					note = `Taken by the server from the board's file, because ${seen.why}. It does not show anything the person did on the page (tabs pressed, text typed, boxes scrolled); ask them to open the board if that matters.`;
				}
				// What the bytes are, not what they were said to be: the snapshot and the board's whole picture are WebP.
				if ((format === "png" || format === "jpeg") && imageKind(bytes)?.format !== format) bytes = await service.shots.convert(bytes, format);
				const kind = imageKind(bytes);
				if (kind) mime = kind.mime;
				const size = imageSize(bytes);
				const file = service.shots.keepBoard(of, bytes, kind?.ext ?? (mime === "image/jpeg" ? "jpg" : "png"), to);
				images.push({ data: bytes.toString("base64"), mimeType: mime });
				const at = here().find((board) => board.path === of)!;
				note += " Only the board: the drawing around it (arrows, labels, notes touching it) is not in this picture; pass its box as `of` to see that too.";
				return { file, width: size.width, height: size.height, box: { x1: at.x, y1: at.y, x2: at.x + at.w, y2: at.y + at.h }, how: seen.how === "none" ? ("server" as const) : seen.how, note };
			}
			/*
			 * A .pen file, whole: a saved frame (`"frames/ui/button.pen"`), another stage's file, any .pen
			 * by path. Named by a path that ends in .pen, or by one that is not an item on this stage and is a file.
			 */
			const pens = service.pens;
			const penFileOf = (asked: unknown): string | undefined => {
				if (!pens || typeof asked !== "string" || !asked.includes("/")) return undefined;
				if (!asked.endsWith(".pen") && pens.placedOf(needStage()).has(asked)) return undefined;
				try {
					return existsSync(pens.penFile(asked).file) ? asked : undefined;
				} catch {
					return undefined;
				}
			};
			const file = penFileOf(of);
			const shot = await service.shots.take({ stage: needStage(), ...(file ? { file } : { of }), ...(scale !== undefined ? { scale } : {}), ...(format ? { format } : {}), ...(to ? { to } : {}), ...(scheme ? { scheme } : {}), ...(live ? { live: true } : {}) });
			if (shot.format !== "pdf") images.push({ data: shot.bytes.toString("base64"), mimeType: shot.format === "jpeg" ? "image/jpeg" : "image/png" });
			return { file: shot.file, width: shot.width, height: shot.height, box: shot.box, how: shot.how };
		},
	};
}
