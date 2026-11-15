#!/usr/bin/env node
import { run } from "./index.ts";

// The decks command's entry: node clients/cli/main.ts <noun> <verb> ...

process.exit(await run(process.argv.slice(2)));
