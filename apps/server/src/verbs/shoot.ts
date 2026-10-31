import { existsSync } from "node:fs";
import { imageKind, imageSize, type ShotFormat, type ShotOf } from "../stage/shots.ts";
import type { VerbContext } from "./context.ts";

/**
 * A picture of one canvas, or of part of it, as the person sees it: the drawing and the live boards
 * together. Attached to the call's result so the caller sees it at once, and saved to `file`. `of`
 * is an item's id, a board's path, a list of them, or a box; nothing is the whole canvas.
 */
export async function shootOn(ctx: VerbContext, stage: string, options?: { of?: ShotOf; scale?: number; format?: ShotFormat; to?: string; scheme?: "light" | "dark"; live?: boolean }) {
	const { service, agent, images } = ctx;
	const onIt = () => (service.pens ? service.pens.boards(stage) : []);
	if (!service.shots) throw new Error("This server cannot take pictures of a stage.");
	const { of, scale, format, to, scheme, live } = options ?? {};
	/*
	 * One board, by its path: as the person's browser has it now, so the picture shows what
	 * they did on the page — drawn there by HTML-in-Canvas when it can be, from a snapshot of
	 * the page otherwise. With no live page to draw, the server's picture from the file, and
	 * the answer says it does not show their interaction.
	 */
	if (typeof of === "string" && format !== "pdf" && onIt().some((board) => board.path === of)) {
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
		const at = onIt().find((board) => board.path === of)!;
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
		if (!asked.endsWith(".pen") && pens.placedOf(stage).has(asked)) return undefined;
		try {
			return existsSync(pens.penFile(asked).file) ? asked : undefined;
		} catch {
			return undefined;
		}
	};
	const file = penFileOf(of);
	const shot = await service.shots.take({ stage, ...(file ? { file } : { of }), ...(scale !== undefined ? { scale } : {}), ...(format ? { format } : {}), ...(to ? { to } : {}), ...(scheme ? { scheme } : {}), ...(live ? { live: true } : {}) });
	if (shot.format !== "pdf") images.push({ data: shot.bytes.toString("base64"), mimeType: shot.format === "jpeg" ? "image/jpeg" : "image/png" });
	return { file: shot.file, width: shot.width, height: shot.height, box: shot.box, how: shot.how };
}
