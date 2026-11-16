import type { Response } from "express";
import { sendFile } from "./shared.ts";

/**
 * Anything else under `/api/card/*path` (`card-path.ts`): a file of the deck, already given the
 * asset's headers. Last in the route, so it always answers.
 */
export async function assetAnswer(target: string, res: Response): Promise<void> {
	await sendFile(res, target);
}
