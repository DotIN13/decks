// Today's names the switch-over must say: the packages Loom keeps, and checks named by today's words.

/** Moved by Loom in wave 3: kept, still imported by name. */
/** Kept until Loom moves the canvas library (map step 4a): the three old packages it still reads come last. */
export const KEPT = ["packages/canvas", "packages/card-host", "packages/ink", "packages/docs", "packages/pen", "packages/ui", "packages/stage", "packages/protocol", "packages/api", "packages/hub"];

/** Checks with no owner in runs.json whose subject is a feature's, by today's name. */
export const BY_NAME = { "old-board": "Roster", stages: "Pane" };

/** apps/web's two scripts the kept packages need, kept where they are until Loom moves them, by today's names. */
export const KEEP_IN_WEB = {
	"apps/web/scripts/stage-backends.ts": "the engine's goldens on three backends, which the stage-goldens check runs; it goes with packages/stage (Loom's step 3)",
	"apps/web/scripts/gen-font-coverage.mjs": "writes packages/canvas/src/look/font-coverage.ts; it goes with the canvas library (Loom's step 4a)",
};
