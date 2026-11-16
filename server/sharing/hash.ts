import { createHash } from "node:crypto";

// A file's hash as both sides of sync name it: sha-256, in hex.

export const hashOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
