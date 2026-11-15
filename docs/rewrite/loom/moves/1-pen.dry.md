# Step 1-pen: pen/: packages/pen moved to the top, src/ flattened, the name @decks/pen kept

Dry run on 111525a5. Nothing was moved.

- files moved by git mv: 29
- files taken out of git (moved on disk): 0
- files edited or created: 11
- import lines rewritten: 17
- warnings: 0

## Moved

- packages/pen/package.json -> pen/package.json
- packages/pen/src/arrow-fixtures.test.ts -> pen/arrow-fixtures.test.ts
- packages/pen/src/arrows.ts -> pen/arrows.ts
- packages/pen/src/calls.test.ts -> pen/calls.test.ts
- packages/pen/src/clip.test.ts -> pen/clip.test.ts
- packages/pen/src/clip.ts -> pen/clip.ts
- packages/pen/src/colors.test.ts -> pen/colors.test.ts
- packages/pen/src/colors.ts -> pen/colors.ts
- packages/pen/src/diff.test.ts -> pen/diff.test.ts
- packages/pen/src/diff.ts -> pen/diff.ts
- packages/pen/src/doc.ts -> pen/doc.ts
- packages/pen/src/fields.test.ts -> pen/fields.test.ts
- packages/pen/src/fields.ts -> pen/fields.ts
- packages/pen/src/geometry.ts -> pen/geometry.ts
- packages/pen/src/html.test.ts -> pen/html.test.ts
- packages/pen/src/html.ts -> pen/html.ts
- packages/pen/src/index.ts -> pen/index.ts
- packages/pen/src/layout.ts -> pen/layout.ts
- packages/pen/src/ops.ts -> pen/ops.ts
- packages/pen/src/outline.ts -> pen/outline.ts
- packages/pen/src/pen.test.ts -> pen/pen.test.ts
- packages/pen/src/read.ts -> pen/read.ts
- packages/pen/src/refs.ts -> pen/refs.ts
- packages/pen/src/schema.test.ts -> pen/schema.test.ts
- packages/pen/src/shapes.test.ts -> pen/shapes.test.ts
- packages/pen/src/shapes.ts -> pen/shapes.ts
- packages/pen/src/types.ts -> pen/types.ts
- packages/pen/src/values.ts -> pen/values.ts
- packages/pen/tsconfig.json -> pen/tsconfig.json

## Lines rewritten

e2e/harness.mjs:28
  - import { applyEdits } from "../packages/pen/src/diff.ts";
  + import { applyEdits } from "../pen/diff.ts";
pen/package.json:6
  - "exports": { ".": "./src/index.ts" },
  + "exports": { ".": "./index.ts" },
pen/arrow-fixtures.test.ts:14
  - const FILE = fileURLToPath(new URL("../../stage/crates/scene/fixtures/arrows.json", import.meta.url));
  + const FILE = fileURLToPath(new URL("../packages/stage/crates/scene/fixtures/arrows.json", import.meta.url));
pen/colors.test.ts:66
  - const guide = readFileSync(new URL("../../../runtime/skills/canvas-authoring/SKILL.md", import.meta.url), "utf8");
  + const guide = readFileSync(new URL("../runtime/skills/canvas-authoring/SKILL.md", import.meta.url), "utf8");
pen/colors.test.ts:68
  - const skill = readFileSync(new URL("../../../runtime/skills/canvas-authoring/colors.md", import.meta.url), "utf8");
  + const skill = readFileSync(new URL("../runtime/skills/canvas-authoring/colors.md", import.meta.url), "utf8");
pen/colors.test.ts:74
  - const design = readFileSync(new URL("../../../runtime/skills/canvas-design/SKILL.md", import.meta.url), "utf8");
  + const design = readFileSync(new URL("../runtime/skills/canvas-design/SKILL.md", import.meta.url), "utf8");
pen/schema.test.ts:5
  - const root = new URL("../../../", import.meta.url);
  + const root = new URL("../", import.meta.url);
pen/tsconfig.json:2
  - "extends": "../../tsconfig.base.json",
  + "extends": "../tsconfig.base.json",
scripts/gen-pen-schema.mjs:2
  - //   packages/pen/src/types.ts   each field's values and its comment (PenNode, Fill, Effect)
  + //   pen/types.ts   each field's values and its comment (PenNode, Fill, Effect)
scripts/gen-pen-schema.mjs:3
  - //   packages/pen/src/fields.ts  which item type has which field, and what Decks keeps without drawing
  + //   pen/fields.ts  which item type has which field, and what Decks keeps without drawing
scripts/gen-pen-schema.mjs:8
  - import { FIELDS, UNDRAWN_EFFECTS, UNDRAWN_FILLS } from "../packages/pen/src/fields.ts";
  + import { FIELDS, UNDRAWN_EFFECTS, UNDRAWN_FILLS } from "../pen/fields.ts";
scripts/gen-pen-schema.mjs:11
  - const typesFile = `${root}packages/pen/src/types.ts`;
  + const typesFile = `${root}pen/types.ts`;
scripts/gen-pen-schema.mjs:71
  - parts.push(`<!-- Generated from packages/pen/src/types.ts and fields.ts by scripts/gen-pen-schema.mjs. Edit those, then run the script. -->
  + parts.push(`<!-- Generated from pen/types.ts and fields.ts by scripts/gen-pen-schema.mjs. Edit those, then run the script. -->
scripts/gen-pen-schema.mjs:135
  - console.error("runtime/skills/canvas-design/schema.md is out of date with packages/pen: run node --import tsx scripts/gen-pen-schema.mjs");
  + console.error("runtime/skills/canvas-design/schema.md is out of date with pen: run node --import tsx scripts/gen-pen-schema.mjs");
tools/checks/fixtures.test.mjs:1
  - // The fixture drawings still lay out as their expected layouts say, by today's packages/pen.
  + // The fixture drawings still lay out as their expected layouts say, by today's pen.
tools/fixtures/layouts.mjs:1
  - // Expected layouts of the fixture drawings, as today's packages/pen lays them out.
  + // Expected layouts of the fixture drawings, as today's pen lays them out.
tools/fixtures/layouts.mjs:6
  - import { baseTheme, parse, placements, warnings } from "../../packages/pen/src/index.ts";
  + import { baseTheme, parse, placements, warnings } from "../../pen/index.ts";

## Files the table edits or creates

- package.json
- pen/README.md

## Warnings

- none

## Old paths still written (not rewritten: comments and docs)

- AGENTS.md: 1
- docs/COMPAT.md: 1
- docs/REORGANIZATION.md: 2
- harness/prompts/skills/canvas-authoring/colors.md: 1
- harness/prompts/skills/canvas-design/schema.md: 1
- scripts/README.md: 2
- tools/fixtures/README.md: 2

## Then run

- node tools/heavy.mjs --wait -- npm install
- Warden's adopt command for pen/ (its breaks under their new paths), with --renames 1-pen.renames.json
- node tools/check.mjs pen && node tools/check.mjs server && node tools/check.mjs harness
- node tools/gates/run.mjs
- node tools/checks/run.mjs stage-goldens, then stage-shot, then placeholder (one slot each)
- commit with REWRITE_AGENT=Loom: Move pen to the top folder pen/
