# Step 4e-12-readmes: Regroup canvas: READMEs for render/, look/, documents/ and the whole folder

Dry run on b8ce78d6, on top of 4a-canvas, 4b-ink, 4c-card-runtime, 4d-documents, 4e-01-entries, 4e-02-camera, 4e-03-view, 4e-04-input, 4e-05-editor, 4e-06-drawing, 4e-07-items, 4e-08-cards, 4e-09-ink, 4e-10-chrome, 4e-11-host. Nothing was moved.

- files moved by git mv: 0
- files taken out of git (moved on disk): 0
- files deleted: 0
- files edited or created: 4
- import lines rewritten: 0
- warnings: 0

## Moved


## Lines rewritten


## Files the table edits or creates

- canvas/render/README.md
- canvas/look/README.md
- canvas/documents/README.md
- canvas/README.md

## Warnings

- none

## Old paths in code lines (review each: list it in paths, keep it, or leave it with a reason)

- none

## Old paths still written (not rewritten: comments and docs)

- none

## Then run

- --go re-keys the gate baselines with the files (tools/gates/rekey.mjs) and stages them; node tools/gates/run.mjs --shrink for the keys of deleted or untracked files; commit the baselines with the move
- node tools/check.mjs canvas && node tools/check.mjs harness
- node tools/gates/run.mjs
- node tools/checks/run.mjs: none (READMEs only) (one slot each)
- commit with REWRITE_AGENT=Loom: Regroup canvas: READMEs for render/, look/, documents/ and t
