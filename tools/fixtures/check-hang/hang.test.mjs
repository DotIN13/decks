import { test } from "node:test";
import { createServer } from "node:http";
test("keeps a server alive", () => { createServer().listen(0); });
