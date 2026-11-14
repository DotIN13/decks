import { fileURLToPath } from "node:url";

// Where the generators read and write.

export const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
export const OUT = `${ROOT}/dist-gen`;
