/** What a person writes to an agent: the field, and the draft it edits (words, and mentions of boards, items and comments). */
export { DraftField, type DraftFieldApi, type DraftFieldProps } from "../composer/DraftField.tsx";
export { commentLabel, draftComments, draftForAgent, draftIsEmpty, draftLabel, draftText, mentionAddress, normalize, parseDraft, serializeDraft, shortLabel, textDraft, DRAFT_MIME, LABEL_LIMIT, type Draft, type DraftMention, type DraftNode, type MentionKind } from "../composer/draft.ts";
export * from "../composer/DraftField.tsx";
export * from "../composer/draft.ts";
export * from "../composer/mention.ts";
export * from "../composer/pill-card.ts";
