import type { Infer, shapes } from "../../protocol/index.ts";

// The protocol's shapes this feature answers with, as types.

export type File = Infer<typeof shapes.File>;
export type FileText = Infer<typeof shapes.FileText>;
export type FileMatch = Infer<typeof shapes.FileMatch>;
export type TextEdit = Infer<typeof shapes.TextEdit>;
export type Card = Infer<typeof shapes.Card>;
export type Placement = Infer<typeof shapes.Placement>;
