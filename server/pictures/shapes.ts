import type { Infer, shapes } from "../../protocol/index.ts";

// The protocol's shapes this feature answers with, as types.

export type File = Infer<typeof shapes.File>;
export type Placement = Infer<typeof shapes.Placement>;
export type Screenshot = Infer<typeof shapes.Screenshot>;
export type Size = Infer<typeof shapes.Size>;
export type Box = Infer<typeof shapes.Box>;
