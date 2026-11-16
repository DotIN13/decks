// The chat and the composer for another program to mount (Studio's page): the parts, their styles in
// styles.css, and the host the composer is handed. It imports nothing of the rest of the harness's page.

export { AgentUi } from "./view.tsx";
export { mountAgentUi, type AgentUiMount } from "./actions.ts";
export { HOST_FIELDS, missingFromHost } from "./model.ts";
export { setAgentUiHost, type AgentMenuProps, type AgentUiHost, type FaceProps } from "../composer/host.ts";

// The conversation.
export { Stream, type StreamProps } from "../chat/stream/view.tsx";
export { PAGE, prepend } from "../chat/stream/model.ts";
export { Turn, type MineReader, type MineReading } from "../chat/turn/view.tsx";
export { setMineReader } from "../chat/turn/actions.ts";
export { ToolChip, ToolGroup } from "../chat/tool/view.tsx";
export { askFullResult, awaitingResult, forgetAskedResults, fullResult, receiveToolResult, resetToolResults, setToolResultSender } from "../chat/tool/actions.ts";
export { TimeMachine } from "../chat/time-machine/view.tsx";
export { StatusLine, WorkingSign } from "../chat/status/view.tsx";
export { isWorking, workingWords } from "../chat/status/model.ts";
export { Markdown } from "../chat/markdown/view.tsx";

// The composer.
export { Composer, type ComposerProps } from "../composer/bar/view.tsx";
export { DraftField, type DraftFieldApi, type DraftFieldProps } from "../composer/draft/view.tsx";
export { commentLabel, draftComments, draftForAgent, draftIsEmpty, draftText, fileMention, normalize, parseDraft, serializeDraft, textDraft, type Draft, type DraftMention, type DraftNode, type MentionKind } from "../composer/draft/model.ts";
export { shortLabel } from "@decks/ui";
export { aboutAddress, aboutComment, commentPill, type ItemName, type TitleOf, type WaitingComment } from "../composer/pill/about.ts";
export { aboutSent, messageParts, readParts, readSent } from "../composer/pill/sent.ts";
export { destination, destinationLabel, stripMention, withoutName, type BarContext, type Destination } from "../composer/bar/destination.ts";
export { RECOGNISERS, VOICE_LANGS, setRecogniser, setVoiceLang } from "../composer/voice/voice.ts";
export { ContextDial, ContextRing } from "../composer/context/view.tsx";
export { contextLevel, contextPercent, usageLevel } from "../composer/context/model.ts";
