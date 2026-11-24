type __ParaglideMessageMetadata<Inputs, Options, Markup extends import("../runtime.js").MessageMarkupSchema> = import("../runtime.js").MessageMetadata<Inputs, Options, Markup>;
/**
* | output |
* | --- |
* | "Add an agent" |
*
*/
export const agents_add: ((inputs?: Agents_AddInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_AddInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{label}: pick its runtime" |
*
*/
export const agents_add_title: ((inputs: Agents_Add_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Add_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Agents" |
*
*/
export const agents_agents: ((inputs?: Agents_AgentsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_AgentsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Browse the cards" |
*
*/
export const agents_browse_label: ((inputs?: Agents_Browse_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Browse_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Browse: read the cards, move and retype what is drawn" |
*
*/
export const agents_browse_title: ((inputs?: Agents_Browse_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Browse_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close {name}" |
*
*/
export const agents_close: ((inputs: Agents_CloseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_CloseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close {name} — the transcript stays on disk. Delete does the same." |
*
*/
export const agents_close_title: ((inputs: Agents_Close_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Close_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Allow" |
*
*/
export const agents_dialog_allow: ((inputs?: Agents_Dialog_AllowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Dialog_AllowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cancel" |
*
*/
export const agents_dialog_cancel: ((inputs?: Agents_Dialog_CancelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Dialog_CancelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "An extension asked for a terminal screen, which this app has no equivalent of." |
*
*/
export const agents_dialog_custom: ((inputs?: Agents_Dialog_CustomInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Dialog_CustomInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Deny" |
*
*/
export const agents_dialog_deny: ((inputs?: Agents_Dialog_DenyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Dialog_DenyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Dismiss" |
*
*/
export const agents_dialog_dismiss: ((inputs?: Agents_Dialog_DismissInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Dialog_DismissInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Done" |
*
*/
export const agents_dialog_done: ((inputs?: Agents_Dialog_DoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Dialog_DoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Other…" |
*
*/
export const agents_dialog_other: ((inputs?: Agents_Dialog_OtherInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Dialog_OtherInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Paste the code from the browser" |
*
*/
export const agents_dialog_paste_code: ((inputs?: Agents_Dialog_Paste_CodeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Dialog_Paste_CodeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Send" |
*
*/
export const agents_dialog_send: ((inputs?: Agents_Dialog_SendInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Dialog_SendInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign in" |
*
*/
export const agents_dialog_sign_in: ((inputs?: Agents_Dialog_Sign_InInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Dialog_Sign_InInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Something else…" |
*
*/
export const agents_dialog_something_else: ((inputs?: Agents_Dialog_Something_ElseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Dialog_Something_ElseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Dormant" |
*
*/
export const agents_dormant: ((inputs?: Agents_DormantInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_DormantInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Draw on the canvas" |
*
*/
export const agents_draw: ((inputs?: Agents_DrawInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_DrawInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Add a tag" |
*
*/
export const agents_edit_add_tag: ((inputs?: Agents_Edit_Add_TagInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Edit_Add_TagInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close" |
*
*/
export const agents_edit_close: ((inputs?: Agents_Edit_CloseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Edit_CloseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Edit {name}" |
*
*/
export const agents_edit_label: ((inputs: Agents_Edit_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Edit_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Name" |
*
*/
export const agents_edit_name: ((inputs?: Agents_Edit_NameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Edit_NameInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Agent name" |
*
*/
export const agents_edit_name_label: ((inputs?: Agents_Edit_Name_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Edit_Name_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Another agent is already called {name}." |
*
*/
export const agents_edit_name_taken: ((inputs: Agents_Edit_Name_TakenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Edit_Name_TakenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "New workspace…" |
*
*/
export const agents_edit_new_workspace: ((inputs?: Agents_Edit_New_WorkspaceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Edit_New_WorkspaceInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Remove {tag}" |
*
*/
export const agents_edit_remove_tag: ((inputs: Agents_Edit_Remove_TagInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Edit_Remove_TagInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Tags" |
*
*/
export const agents_edit_tags: ((inputs?: Agents_Edit_TagsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Edit_TagsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Find an agent" |
*
*/
export const agents_find: ((inputs?: Agents_FindInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_FindInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No agent matches that" |
*
*/
export const agents_find_none: ((inputs?: Agents_Find_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Find_NoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Click to switch to {name}" |
*
*/
export const agents_hover_click: ((inputs: Agents_Hover_ClickInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Hover_ClickInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "just now" |
*
*/
export const agents_just_now: ((inputs?: Agents_Just_NowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Just_NowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{shown} more agent" |
* | "other" | "{shown} more agents" |
*
*/
export const agents_menu_more: ((inputs: Agents_Menu_MoreInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Menu_MoreInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{shown} more agent — open the Agents panel." |
* | "other" | "{shown} more agents — open the Agents panel." |
*
*/
export const agents_menu_more_open: ((inputs: Agents_Menu_More_OpenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Menu_More_OpenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Move to…" |
*
*/
export const agents_menu_move: ((inputs?: Agents_Menu_MoveInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Menu_MoveInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Remove agent" |
*
*/
export const agents_menu_remove: ((inputs?: Agents_Menu_RemoveInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Menu_RemoveInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "It is mid-turn: stop it first" |
*
*/
export const agents_menu_remove_busy: ((inputs?: Agents_Menu_Remove_BusyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Menu_Remove_BusyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Rename…" |
*
*/
export const agents_menu_rename: ((inputs?: Agents_Menu_RenameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Menu_RenameInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Stop its turn" |
*
*/
export const agents_menu_stop: ((inputs?: Agents_Menu_StopInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Menu_StopInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Nothing is running" |
*
*/
export const agents_menu_stop_idle: ((inputs?: Agents_Menu_Stop_IdleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Menu_Stop_IdleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Edit tags…" |
*
*/
export const agents_menu_tags: ((inputs?: Agents_Menu_TagsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Menu_TagsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Talk to it here" |
*
*/
export const agents_menu_talk: ((inputs?: Agents_Menu_TalkInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Menu_TalkInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Mode" |
*
*/
export const agents_mode: ((inputs?: Agents_ModeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_ModeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "New agent" |
*
*/
export const agents_new: ((inputs?: Agents_NewInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_NewInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No workspace" |
*
*/
export const agents_no_workspace: ((inputs?: Agents_No_WorkspaceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_No_WorkspaceInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No agent" |
*
*/
export const agents_none: ((inputs?: Agents_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_NoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "not installed" |
*
*/
export const agents_not_installed: ((inputs?: Agents_Not_InstalledInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Not_InstalledInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "away · {ago}" |
*
*/
export const agents_outside_away: ((inputs: Agents_Outside_AwayInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Outside_AwayInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Calling now." |
*
*/
export const agents_outside_calling: ((inputs?: Agents_Outside_CallingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Outside_CallingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "here" |
*
*/
export const agents_outside_here: ((inputs?: Agents_Outside_HereInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Outside_HereInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Its last call was {ago} ago." |
*
*/
export const agents_outside_last_call: ((inputs: Agents_Outside_Last_CallInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Outside_Last_CallInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{shown} message waits for its next call." |
* | "other" | "{shown} messages wait for its next call." |
*
*/
export const agents_outside_messages_wait: ((inputs: Agents_Outside_Messages_WaitInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Outside_Messages_WaitInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{count} waiting" |
*
*/
export const agents_outside_waiting: ((inputs: Agents_Outside_WaitingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Outside_WaitingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Works in {client}, outside Decks." |
*
*/
export const agents_outside_works: ((inputs: Agents_Outside_WorksInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Outside_WorksInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Agents panel" |
*
*/
export const agents_panel: ((inputs?: Agents_PanelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_PanelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Agents — currently {name}" |
*
*/
export const agents_pill_label: ((inputs: Agents_Pill_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Pill_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "“{text}”" |
*
*/
export const agents_quote: ((inputs: Agents_QuoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_QuoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} — the conversation on screen" |
*
*/
export const agents_row_current_title: ((inputs: Agents_Row_Current_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Row_Current_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name}'s menu" |
*
*/
export const agents_row_menu: ((inputs: Agents_Row_MenuInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Row_MenuInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "More for {name}" |
*
*/
export const agents_row_more_label: ((inputs: Agents_Row_More_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Row_More_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name}: more" |
*
*/
export const agents_row_more_title: ((inputs: Agents_Row_More_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Row_More_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "new" |
*
*/
export const agents_row_new: ((inputs?: Agents_Row_NewInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Row_NewInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "now" |
*
*/
export const agents_row_now: ((inputs?: Agents_Row_NowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Row_NowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{shown} wants you" |
* | "other" | "{shown} want you" |
*
*/
export const agents_section_wants: ((inputs: Agents_Section_WantsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Section_WantsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{count} working" |
*
*/
export const agents_section_working: ((inputs: Agents_Section_WorkingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Section_WorkingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Hide the side panel" |
*
*/
export const agents_side_panel_hide: ((inputs?: Agents_Side_Panel_HideInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Side_Panel_HideInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show the side panel" |
*
*/
export const agents_side_panel_show: ((inputs?: Agents_Side_Panel_ShowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Side_Panel_ShowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Side panel (⌘\\)" |
*
*/
export const agents_side_panel_title: ((inputs?: Agents_Side_Panel_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Side_Panel_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Agents wanting your attention" |
*
*/
export const agents_stack_label: ((inputs?: Agents_Stack_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Stack_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{shown} more agent wanting you" |
* | "other" | "{shown} more agents wanting you" |
*
*/
export const agents_stack_more: ((inputs: Agents_Stack_MoreInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Stack_MoreInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Switch to {name} — {status}" |
*
*/
export const agents_stack_switch: ((inputs: Agents_Stack_SwitchInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Stack_SwitchInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Canvases, currently {name}" |
*
*/
export const agents_stage_label: ((inputs: Agents_Stage_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Stage_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Canvases, this chat is on none" |
*
*/
export const agents_stage_none: ((inputs?: Agents_Stage_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Stage_NoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Canvas: {name}" |
*
*/
export const agents_stage_title: ((inputs: Agents_Stage_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Stage_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Canvases" |
*
*/
export const agents_stages: ((inputs?: Agents_StagesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_StagesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Done, not read yet" |
*
*/
export const agents_status_done: ((inputs?: Agents_Status_DoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Status_DoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Idle" |
*
*/
export const agents_status_idle: ((inputs?: Agents_Status_IdleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Status_IdleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Thinking…" |
*
*/
export const agents_status_thinking: ((inputs?: Agents_Status_ThinkingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Status_ThinkingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Running tools…" |
*
*/
export const agents_status_tool: ((inputs?: Agents_Status_ToolInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Status_ToolInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Typing…" |
*
*/
export const agents_status_typing: ((inputs?: Agents_Status_TypingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Status_TypingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Waiting for you" |
*
*/
export const agents_status_waiting: ((inputs?: Agents_Status_WaitingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Status_WaitingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Switch agent" |
*
*/
export const agents_switch: ((inputs?: Agents_SwitchInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_SwitchInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Switch to {name}" |
*
*/
export const agents_switch_to: ((inputs: Agents_Switch_ToInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Switch_ToInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Your tag: {tag}" |
*
*/
export const agents_tag_mine: ((inputs: Agents_Tag_MineInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Tag_MineInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} is working on {tag}" |
*
*/
export const agents_tag_theirs: ((inputs: Agents_Tag_TheirsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Tag_TheirsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "View only · Make a copy" |
*
*/
export const agents_view_only: ((inputs?: Agents_View_OnlyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_View_OnlyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shared with you to view by {owner}: it follows their copy. Make your own copy to change it." |
*
*/
export const agents_view_only_title: ((inputs: Agents_View_Only_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_View_Only_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Workspace" |
*
*/
export const agents_workspace: ((inputs?: Agents_WorkspaceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_WorkspaceInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Create" |
*
*/
export const agents_ws_create: ((inputs?: Agents_Ws_CreateInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Ws_CreateInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Workspace name" |
*
*/
export const agents_ws_name_label: ((inputs?: Agents_Ws_Name_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Ws_Name_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Name" |
*
*/
export const agents_ws_name_placeholder: ((inputs?: Agents_Ws_Name_PlaceholderInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Ws_Name_PlaceholderInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Named" |
*
*/
export const agents_ws_named: ((inputs?: Agents_Ws_NamedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Agents_Ws_NamedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cancel" |
*
*/
export const app_cancel: ((inputs?: App_CancelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_CancelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Clear the canvas" |
*
*/
export const app_clear_canvas: ((inputs?: App_Clear_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Clear_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Dark mode" |
*
*/
export const app_dark_mode: ((inputs?: App_Dark_ModeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Dark_ModeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delete" |
*
*/
export const app_delete: ((inputs?: App_DeleteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_DeleteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Its folder, apps/{folder}, moves to the deck's trash, and the items showing it leave the canvases." |
*
*/
export const app_delete_app_body: ((inputs: App_Delete_App_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Delete_App_BodyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delete {name}?" |
*
*/
export const app_delete_app_title: ((inputs: App_Delete_App_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Delete_App_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "no agent" |
*
*/
export const app_dest_none: ((inputs?: App_Dest_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Dest_NoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "note on {card}" |
*
*/
export const app_dest_note: ((inputs: App_Dest_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Dest_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "to {name}" |
*
*/
export const app_dest_to: ((inputs: App_Dest_ToInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Dest_ToInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} could not be opened: {error}" |
*
*/
export const app_file_open_failed: ((inputs: App_File_Open_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_File_Open_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} finished" |
*
*/
export const app_finished: ((inputs: App_FinishedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_FinishedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Go" |
*
*/
export const app_go: ((inputs?: App_GoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_GoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No card at {path}: the link points at something this deck does not have." |
*
*/
export const app_no_card_at: ((inputs: App_No_Card_AtInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_No_Card_AtInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "That is not on this canvas." |
*
*/
export const app_not_on_canvas: ((inputs?: App_Not_On_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Not_On_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Notes on a component are not built yet." |
*
*/
export const app_notes_not_built: ((inputs?: App_Notes_Not_BuiltInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Notes_Not_BuiltInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open" |
*
*/
export const app_open: ((inputs?: App_OpenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_OpenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open a tab" |
*
*/
export const app_open_tab: ((inputs?: App_Open_TabInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Open_TabInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} is your own copy: change it as you like. It never changes theirs." |
*
*/
export const app_own_copy: ((inputs: App_Own_CopyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Own_CopyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pick an agent first." |
*
*/
export const app_pick_agent: ((inputs?: App_Pick_AgentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Pick_AgentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The picture could not be taken: {error}" |
*
*/
export const app_picture_failed: ((inputs: App_Picture_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Picture_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the server answered {status}" |
*
*/
export const app_server_answered: ((inputs: App_Server_AnsweredInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Server_AnsweredInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Settings" |
*
*/
export const app_settings: ((inputs?: App_SettingsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_SettingsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shortcuts" |
*
*/
export const app_shortcuts: ((inputs?: App_ShortcutsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_ShortcutsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show" |
*
*/
export const app_show: ((inputs?: App_ShowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_ShowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "something on the canvas" |
*
*/
export const app_something_on_canvas: ((inputs?: App_Something_On_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Something_On_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Something went wrong" |
*
*/
export const app_something_wrong: ((inputs?: App_Something_WrongInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Something_WrongInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Bring the input bar back" |
*
*/
export const app_stow_back: ((inputs?: App_Stow_BackInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Stow_BackInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Taking the picture…" |
*
*/
export const app_taking_picture: ((inputs?: App_Taking_PictureInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Taking_PictureInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} is waiting for you" |
*
*/
export const app_waiting: ((inputs: App_WaitingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_WaitingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} wants to take you to the canvas {canvas}" |
*
*/
export const app_wants_goto: ((inputs: App_Wants_GotoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Wants_GotoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} wants to show you {what}" |
*
*/
export const app_wants_show: ((inputs: App_Wants_ShowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<App_Wants_ShowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close: take the window off the canvas" |
*
*/
export const canvas_app_close_title: ((inputs?: Canvas_App_Close_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_App_Close_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Collapse" |
*
*/
export const canvas_app_collapse: ((inputs?: Canvas_App_CollapseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_App_CollapseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Collapse to a link to the app" |
*
*/
export const canvas_app_collapse_title: ((inputs?: Canvas_App_Collapse_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_App_Collapse_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This app opens from the Decks app." |
*
*/
export const canvas_app_needs_decks: ((inputs?: Canvas_App_Needs_DecksInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_App_Needs_DecksInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The app did not open here ({status})." |
*
*/
export const canvas_app_not_opened: ((inputs: Canvas_App_Not_OpenedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_App_Not_OpenedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open" |
*
*/
export const canvas_app_open: ((inputs?: Canvas_App_OpenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_App_OpenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open in a tab" |
*
*/
export const canvas_app_open_tab: ((inputs?: Canvas_App_Open_TabInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_App_Open_TabInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Opening {name}…" |
*
*/
export const canvas_app_opening: ((inputs: Canvas_App_OpeningInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_App_OpeningInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} runs in a tab of its own." |
*
*/
export const canvas_app_own_tab: ((inputs: Canvas_App_Own_TabInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_App_Own_TabInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Accept" |
*
*/
export const canvas_card_accept: ((inputs?: Canvas_Card_AcceptInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_AcceptInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Body text" |
*
*/
export const canvas_card_block_body: ((inputs?: Canvas_Card_Block_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Block_BodyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Code block" |
*
*/
export const canvas_card_block_code: ((inputs?: Canvas_Card_Block_CodeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Block_CodeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Heading 1" |
*
*/
export const canvas_card_block_h1: ((inputs?: Canvas_Card_Block_H1Inputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Block_H1Inputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Heading 2" |
*
*/
export const canvas_card_block_h2: ((inputs?: Canvas_Card_Block_H2Inputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Block_H2Inputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Heading 3" |
*
*/
export const canvas_card_block_h3: ((inputs?: Canvas_Card_Block_H3Inputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Block_H3Inputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Quote" |
*
*/
export const canvas_card_block_quote: ((inputs?: Canvas_Card_Block_QuoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Block_QuoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "What the block is" |
*
*/
export const canvas_card_block_title: ((inputs?: Canvas_Card_Block_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Block_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Bold (⌘B)" |
*
*/
export const canvas_card_bold: ((inputs?: Canvas_Card_BoldInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_BoldInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Checklist" |
*
*/
export const canvas_card_check: ((inputs?: Canvas_Card_CheckInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_CheckInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Clear styling" |
*
*/
export const canvas_card_clear: ((inputs?: Canvas_Card_ClearInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_ClearInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Code (⌘E)" |
*
*/
export const canvas_card_code: ((inputs?: Canvas_Card_CodeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_CodeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "blue" |
*
*/
export const canvas_card_colour_blue: ((inputs?: Canvas_Card_Colour_BlueInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Colour_BlueInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "green" |
*
*/
export const canvas_card_colour_green: ((inputs?: Canvas_Card_Colour_GreenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Colour_GreenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "orange" |
*
*/
export const canvas_card_colour_orange: ((inputs?: Canvas_Card_Colour_OrangeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Colour_OrangeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "purple" |
*
*/
export const canvas_card_colour_purple: ((inputs?: Canvas_Card_Colour_PurpleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Colour_PurpleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "red" |
*
*/
export const canvas_card_colour_red: ((inputs?: Canvas_Card_Colour_RedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Colour_RedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "yellow" |
*
*/
export const canvas_card_colour_yellow: ((inputs?: Canvas_Card_Colour_YellowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Colour_YellowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the card's own" |
*
*/
export const canvas_card_font_default: ((inputs?: Canvas_Card_Font_DefaultInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Font_DefaultInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Hand and display" |
*
*/
export const canvas_card_fonts_display: ((inputs?: Canvas_Card_Fonts_DisplayInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Fonts_DisplayInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Mono" |
*
*/
export const canvas_card_fonts_mono: ((inputs?: Canvas_Card_Fonts_MonoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Fonts_MonoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sans" |
*
*/
export const canvas_card_fonts_sans: ((inputs?: Canvas_Card_Fonts_SansInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Fonts_SansInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Serif" |
*
*/
export const canvas_card_fonts_serif: ((inputs?: Canvas_Card_Fonts_SerifInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Fonts_SerifInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "item" |
*
*/
export const canvas_card_held_item: ((inputs?: Canvas_Card_Held_ItemInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Held_ItemInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Highlight" |
*
*/
export const canvas_card_highlight: ((inputs?: Canvas_Card_HighlightInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_HighlightInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{colour} highlight" |
*
*/
export const canvas_card_highlight_colour: ((inputs: Canvas_Card_Highlight_ColourInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Highlight_ColourInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "image" |
*
*/
export const canvas_card_image: ((inputs?: Canvas_Card_ImageInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_ImageInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Italic (⌘I)" |
*
*/
export const canvas_card_italic: ((inputs?: Canvas_Card_ItalicInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_ItalicInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Link" |
*
*/
export const canvas_card_link: ((inputs?: Canvas_Card_LinkInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_LinkInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Link to (empty takes the link off)" |
*
*/
export const canvas_card_link_prompt: ((inputs?: Canvas_Card_Link_PromptInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Link_PromptInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No colour" |
*
*/
export const canvas_card_no_colour: ((inputs?: Canvas_Card_No_ColourInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_No_ColourInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No highlight" |
*
*/
export const canvas_card_no_highlight: ((inputs?: Canvas_Card_No_HighlightInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_No_HighlightInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Numbered list" |
*
*/
export const canvas_card_ol: ((inputs?: Canvas_Card_OlInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_OlInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Redo (⌘⇧Z)" |
*
*/
export const canvas_card_redo: ((inputs?: Canvas_Card_RedoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_RedoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Reject" |
*
*/
export const canvas_card_reject: ((inputs?: Canvas_Card_RejectInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_RejectInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Rule" |
*
*/
export const canvas_card_rule: ((inputs?: Canvas_Card_RuleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_RuleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Scripts off · Turn on" |
*
*/
export const canvas_card_scripts_off: ((inputs?: Canvas_Card_Scripts_OffInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Scripts_OffInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This card came from a friend's canvas, so its scripts do not run until you turn them on" |
*
*/
export const canvas_card_scripts_off_title: ((inputs?: Canvas_Card_Scripts_Off_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Scripts_Off_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Size" |
*
*/
export const canvas_card_size: ((inputs?: Canvas_Card_SizeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_SizeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Huge" |
*
*/
export const canvas_card_size_huge: ((inputs?: Canvas_Card_Size_HugeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Size_HugeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Large" |
*
*/
export const canvas_card_size_large: ((inputs?: Canvas_Card_Size_LargeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Size_LargeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Normal" |
*
*/
export const canvas_card_size_normal: ((inputs?: Canvas_Card_Size_NormalInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Size_NormalInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Small" |
*
*/
export const canvas_card_size_small: ((inputs?: Canvas_Card_Size_SmallInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Size_SmallInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Strike (⌘⇧X)" |
*
*/
export const canvas_card_strike: ((inputs?: Canvas_Card_StrikeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_StrikeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show the card at its own size" |
*
*/
export const canvas_card_tab_actual: ((inputs?: Canvas_Card_Tab_ActualInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Tab_ActualInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fit the card to the window" |
*
*/
export const canvas_card_tab_fit_title: ((inputs?: Canvas_Card_Tab_Fit_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Tab_Fit_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Table" |
*
*/
export const canvas_card_table: ((inputs?: Canvas_Card_TableInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_TableInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{colour} text" |
*
*/
export const canvas_card_text_colour: ((inputs: Canvas_Card_Text_ColourInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_Text_ColourInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Bulleted list" |
*
*/
export const canvas_card_ul: ((inputs?: Canvas_Card_UlInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_UlInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Underline (⌘U)" |
*
*/
export const canvas_card_underline: ((inputs?: Canvas_Card_UnderlineInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_UnderlineInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Undo (⌘Z)" |
*
*/
export const canvas_card_undo: ((inputs?: Canvas_Card_UndoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Card_UndoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Accent, blue" |
*
*/
export const canvas_color_accent_blue: ((inputs?: Canvas_Color_Accent_BlueInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Accent_BlueInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Accent, green" |
*
*/
export const canvas_color_accent_green: ((inputs?: Canvas_Color_Accent_GreenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Accent_GreenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Accent, orange" |
*
*/
export const canvas_color_accent_orange: ((inputs?: Canvas_Color_Accent_OrangeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Accent_OrangeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Accent, purple" |
*
*/
export const canvas_color_accent_purple: ((inputs?: Canvas_Color_Accent_PurpleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Accent_PurpleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Accent, red" |
*
*/
export const canvas_color_accent_red: ((inputs?: Canvas_Color_Accent_RedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Accent_RedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Accent, yellow" |
*
*/
export const canvas_color_accent_yellow: ((inputs?: Canvas_Color_Accent_YellowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Accent_YellowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Adaptive" |
*
*/
export const canvas_color_adaptive: ((inputs?: Canvas_Color_AdaptiveInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_AdaptiveInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Adaptive colours" |
*
*/
export const canvas_color_adaptive_group: ((inputs?: Canvas_Color_Adaptive_GroupInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Adaptive_GroupInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} (adaptive): {light} in light, {dark} in dark" |
*
*/
export const canvas_color_adaptive_title: ((inputs: Canvas_Color_Adaptive_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Adaptive_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Colours" |
*
*/
export const canvas_color_colours: ((inputs?: Canvas_Color_ColoursInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_ColoursInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pick a colour from the screen" |
*
*/
export const canvas_color_dropper: ((inputs?: Canvas_Color_DropperInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_DropperInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fill, blue" |
*
*/
export const canvas_color_fill_blue: ((inputs?: Canvas_Color_Fill_BlueInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Fill_BlueInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fill, grey" |
*
*/
export const canvas_color_fill_gray: ((inputs?: Canvas_Color_Fill_GrayInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Fill_GrayInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fill, green" |
*
*/
export const canvas_color_fill_green: ((inputs?: Canvas_Color_Fill_GreenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Fill_GreenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fill, orange" |
*
*/
export const canvas_color_fill_orange: ((inputs?: Canvas_Color_Fill_OrangeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Fill_OrangeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fill, purple" |
*
*/
export const canvas_color_fill_purple: ((inputs?: Canvas_Color_Fill_PurpleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Fill_PurpleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fill, red" |
*
*/
export const canvas_color_fill_red: ((inputs?: Canvas_Color_Fill_RedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Fill_RedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fill, sky" |
*
*/
export const canvas_color_fill_sky: ((inputs?: Canvas_Color_Fill_SkyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Fill_SkyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fill, slate" |
*
*/
export const canvas_color_fill_slate: ((inputs?: Canvas_Color_Fill_SlateInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Fill_SlateInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fill, yellow" |
*
*/
export const canvas_color_fill_yellow: ((inputs?: Canvas_Color_Fill_YellowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Fill_YellowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{label}, as hex" |
*
*/
export const canvas_color_hex: ((inputs: Canvas_Color_HexInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_HexInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Hue" |
*
*/
export const canvas_color_hue: ((inputs?: Canvas_Color_HueInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_HueInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Line" |
*
*/
export const canvas_color_line: ((inputs?: Canvas_Color_LineInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_LineInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Line, strong" |
*
*/
export const canvas_color_line_strong: ((inputs?: Canvas_Color_Line_StrongInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Line_StrongInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Line, subtle" |
*
*/
export const canvas_color_line_subtle: ((inputs?: Canvas_Color_Line_SubtleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Line_SubtleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{label}: pick a colour" |
*
*/
export const canvas_color_picker: ((inputs: Canvas_Color_PickerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_PickerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shade and brightness" |
*
*/
export const canvas_color_shade: ((inputs?: Canvas_Color_ShadeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_ShadeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Surface" |
*
*/
export const canvas_color_surface: ((inputs?: Canvas_Color_SurfaceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_SurfaceInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Text" |
*
*/
export const canvas_color_text: ((inputs?: Canvas_Color_TextInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_TextInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Text, muted" |
*
*/
export const canvas_color_text_muted: ((inputs?: Canvas_Color_Text_MutedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Color_Text_MutedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The copy was not made: {why}" |
*
*/
export const canvas_copy_failed: ((inputs: Canvas_Copy_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Copy_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the harness did not answer" |
*
*/
export const canvas_copy_no_answer: ((inputs?: Canvas_Copy_No_AnswerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Copy_No_AnswerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "agent" |
*
*/
export const canvas_cursor_agent: ((inputs?: Canvas_Cursor_AgentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Cursor_AgentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Documents open in the canvas frame." |
*
*/
export const canvas_document_needs_frame: ((inputs?: Canvas_Document_Needs_FrameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Document_Needs_FrameInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Canvas" |
*
*/
export const canvas_frame_title: ((inputs?: Canvas_Frame_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Frame_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Drag to bend the arrow; double-click for its automatic route" |
*
*/
export const canvas_handle_arrow_bend: ((inputs?: Canvas_Handle_Arrow_BendInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Handle_Arrow_BendInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Drag onto something to join it" |
*
*/
export const canvas_handle_arrow_join: ((inputs?: Canvas_Handle_Arrow_JoinInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Handle_Arrow_JoinInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Slide along the side, or drag off to join something else; double-click for the middle" |
*
*/
export const canvas_handle_arrow_joined: ((inputs?: Canvas_Handle_Arrow_JoinedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Handle_Arrow_JoinedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Drag to round the corners" |
*
*/
export const canvas_handle_corners: ((inputs?: Canvas_Handle_CornersInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Handle_CornersInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Drag to draw an arrow from this side" |
*
*/
export const canvas_handle_draw_arrow: ((inputs?: Canvas_Handle_Draw_ArrowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Handle_Draw_ArrowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Drag to move this block" |
*
*/
export const canvas_handle_move_block: ((inputs?: Canvas_Handle_Move_BlockInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Handle_Move_BlockInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Add an icon…" |
*
*/
export const canvas_hold_add_icon: ((inputs?: Canvas_Hold_Add_IconInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Hold_Add_IconInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Add a shape…" |
*
*/
export const canvas_hold_add_shape: ((inputs?: Canvas_Hold_Add_ShapeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Hold_Add_ShapeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "An item" |
*
*/
export const canvas_hold_an_item: ((inputs?: Canvas_Hold_An_ItemInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Hold_An_ItemInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Ask the agent" |
*
*/
export const canvas_hold_ask: ((inputs?: Canvas_Hold_AskInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Hold_AskInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "drawer" |
*
*/
export const canvas_hold_drawer: ((inputs?: Canvas_Hold_DrawerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Hold_DrawerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Bring to front" |
*
*/
export const canvas_hold_to_front: ((inputs?: Canvas_Hold_To_FrontInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Hold_To_FrontInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Blue" |
*
*/
export const canvas_ink_color_blue: ((inputs?: Canvas_Ink_Color_BlueInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Ink_Color_BlueInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Green" |
*
*/
export const canvas_ink_color_green: ((inputs?: Canvas_Ink_Color_GreenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Ink_Color_GreenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Black or white, with the theme" |
*
*/
export const canvas_ink_color_ink: ((inputs?: Canvas_Ink_Color_InkInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Ink_Color_InkInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Red" |
*
*/
export const canvas_ink_color_red: ((inputs?: Canvas_Ink_Color_RedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Ink_Color_RedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Yellow" |
*
*/
export const canvas_ink_color_yellow: ((inputs?: Canvas_Ink_Color_YellowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Ink_Color_YellowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delete the selected strokes" |
*
*/
export const canvas_ink_delete: ((inputs?: Canvas_Ink_DeleteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Ink_DeleteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delete the selected strokes (Delete)" |
*
*/
export const canvas_ink_delete_title: ((inputs?: Canvas_Ink_Delete_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Ink_Delete_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Eraser: removes each stroke it touches" |
*
*/
export const canvas_ink_eraser: ((inputs?: Canvas_Ink_EraserInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Ink_EraserInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Lasso: loop round strokes to select them, then drag or delete" |
*
*/
export const canvas_ink_lasso: ((inputs?: Canvas_Ink_LassoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Ink_LassoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Marker: wide and see-through, for marking words" |
*
*/
export const canvas_ink_marker: ((inputs?: Canvas_Ink_MarkerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Ink_MarkerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pen: draws, and presses harder with a pencil" |
*
*/
export const canvas_ink_pen: ((inputs?: Canvas_Ink_PenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Ink_PenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Stop drawing" |
*
*/
export const canvas_ink_stop: ((inputs?: Canvas_Ink_StopInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Ink_StopInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Stop drawing (Escape)" |
*
*/
export const canvas_ink_stop_title: ((inputs?: Canvas_Ink_Stop_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Ink_Stop_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Undo your last change to the canvas (⌘Z)" |
*
*/
export const canvas_ink_undo_title: ((inputs?: Canvas_Ink_Undo_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Ink_Undo_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{px} pixels wide" |
*
*/
export const canvas_ink_width: ((inputs: Canvas_Ink_WidthInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Ink_WidthInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{count} found" |
*
*/
export const canvas_insert_found: ((inputs: Canvas_Insert_FoundInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Insert_FoundInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pick one, then click or drag on the canvas." |
*
*/
export const canvas_insert_hint: ((inputs?: Canvas_Insert_HintInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Insert_HintInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pick one to put it where you double-clicked." |
*
*/
export const canvas_insert_hint_at: ((inputs?: Canvas_Insert_Hint_AtInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Insert_Hint_AtInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pick one to put in the selected icon's place." |
*
*/
export const canvas_insert_hint_replace: ((inputs?: Canvas_Insert_Hint_ReplaceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Insert_Hint_ReplaceInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Icons" |
*
*/
export const canvas_insert_icons: ((inputs?: Canvas_Insert_IconsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Insert_IconsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The icon list could not be fetched. Icons come from the internet; already drawn ones stay drawn." |
*
*/
export const canvas_insert_icons_failed: ((inputs?: Canvas_Insert_Icons_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Insert_Icons_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fetching the list of icons…" |
*
*/
export const canvas_insert_icons_loading: ((inputs?: Canvas_Insert_Icons_LoadingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Insert_Icons_LoadingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "More" |
*
*/
export const canvas_insert_more: ((inputs?: Canvas_Insert_MoreInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Insert_MoreInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No icon is called that." |
*
*/
export const canvas_insert_no_icon: ((inputs?: Canvas_Insert_No_IconInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Insert_No_IconInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No shape is called that." |
*
*/
export const canvas_insert_no_shape: ((inputs?: Canvas_Insert_No_ShapeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Insert_No_ShapeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Used lately" |
*
*/
export const canvas_insert_recent: ((inputs?: Canvas_Insert_RecentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Insert_RecentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Search icons" |
*
*/
export const canvas_insert_search_icons: ((inputs?: Canvas_Insert_Search_IconsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Insert_Search_IconsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Search shapes" |
*
*/
export const canvas_insert_search_shapes: ((inputs?: Canvas_Insert_Search_ShapesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Insert_Search_ShapesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shapes" |
*
*/
export const canvas_insert_shapes: ((inputs?: Canvas_Insert_ShapesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Insert_ShapesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Full screen" |
*
*/
export const canvas_media_fullscreen: ((inputs?: Canvas_Media_FullscreenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Media_FullscreenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Mute" |
*
*/
export const canvas_media_mute: ((inputs?: Canvas_Media_MuteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Media_MuteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pause" |
*
*/
export const canvas_media_pause: ((inputs?: Canvas_Media_PauseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Media_PauseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Play" |
*
*/
export const canvas_media_play: ((inputs?: Canvas_Media_PlayInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Media_PlayInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Seek" |
*
*/
export const canvas_media_seek: ((inputs?: Canvas_Media_SeekInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Media_SeekInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sound on" |
*
*/
export const canvas_media_unmute: ((inputs?: Canvas_Media_UnmuteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Media_UnmuteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "an HTML card" |
*
*/
export const canvas_paste_kind_card: ((inputs?: Canvas_Paste_Kind_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Paste_Kind_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "a document" |
*
*/
export const canvas_paste_kind_document: ((inputs?: Canvas_Paste_Kind_DocumentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Paste_Kind_DocumentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "a file" |
*
*/
export const canvas_paste_kind_file: ((inputs?: Canvas_Paste_Kind_FileInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Paste_Kind_FileInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "a picture" |
*
*/
export const canvas_paste_kind_picture: ((inputs?: Canvas_Paste_Kind_PictureInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Paste_Kind_PictureInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The link was not placed." |
*
*/
export const canvas_paste_link_failed: ((inputs?: Canvas_Paste_Link_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Paste_Link_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Not pasted: {what} needs its files copied to this canvas, which Studio cannot do yet. Copy notes, shapes, text, arrows and markdown cards on their own, or pa..." |
*
*/
export const canvas_paste_needs_files: ((inputs: Canvas_Paste_Needs_FilesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Paste_Needs_FilesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Nothing was pasted." |
*
*/
export const canvas_paste_nothing: ((inputs?: Canvas_Paste_NothingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Paste_NothingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This canvas can only be read, so nothing is pasted on it." |
*
*/
export const canvas_paste_read_only: ((inputs?: Canvas_Paste_Read_OnlyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Paste_Read_OnlyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} card" |
* | "other" | "{count} cards" |
*
*/
export const canvas_pill_cards: ((inputs: Canvas_Pill_CardsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_CardsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{cards}, {items}" |
*
*/
export const canvas_pill_cards_and_items: ((inputs: Canvas_Pill_Cards_And_ItemsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Cards_And_ItemsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Comment" |
*
*/
export const canvas_pill_comment: ((inputs?: Canvas_Pill_CommentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_CommentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Comment on this card" |
*
*/
export const canvas_pill_comment_card: ((inputs?: Canvas_Pill_Comment_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Comment_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Comment on this" |
*
*/
export const canvas_pill_comment_this: ((inputs?: Canvas_Pill_Comment_ThisInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Comment_ThisInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Copy path" |
*
*/
export const canvas_pill_copy_path: ((inputs?: Canvas_Pill_Copy_PathInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Copy_PathInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delete" |
*
*/
export const canvas_pill_delete: ((inputs?: Canvas_Pill_DeleteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_DeleteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Take the card off the canvas; its folder stays in the deck" |
*
*/
export const canvas_pill_delete_card: ((inputs?: Canvas_Pill_Delete_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Delete_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Take the document off the canvas; its file stays in the deck" |
*
*/
export const canvas_pill_delete_document: ((inputs?: Canvas_Pill_Delete_DocumentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Delete_DocumentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Duplicate" |
*
*/
export const canvas_pill_duplicate: ((inputs?: Canvas_Pill_DuplicateInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_DuplicateInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Export as PDF" |
*
*/
export const canvas_pill_export_pdf: ((inputs?: Canvas_Pill_Export_PdfInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Export_PdfInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Export as PNG" |
*
*/
export const canvas_pill_export_png: ((inputs?: Canvas_Pill_Export_PngInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Export_PngInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fit" |
*
*/
export const canvas_pill_fit: ((inputs?: Canvas_Pill_FitInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_FitInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fit the card to the screen" |
*
*/
export const canvas_pill_fit_title: ((inputs?: Canvas_Pill_Fit_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Fit_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Hide" |
*
*/
export const canvas_pill_hide: ((inputs?: Canvas_Pill_HideInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_HideInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close the window; the app stays in the deck" |
*
*/
export const canvas_pill_hide_app: ((inputs?: Canvas_Pill_Hide_AppInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Hide_AppInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Hide from the canvas" |
*
*/
export const canvas_pill_hide_title: ((inputs?: Canvas_Pill_Hide_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Hide_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Make a card" |
*
*/
export const canvas_pill_ink_card: ((inputs?: Canvas_Pill_Ink_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Ink_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{agent} builds a card from it, in its place" |
*
*/
export const canvas_pill_ink_card_title: ((inputs: Canvas_Pill_Ink_Card_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Ink_Card_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Make a drawing" |
*
*/
export const canvas_pill_ink_drawing: ((inputs?: Canvas_Pill_Ink_DrawingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Ink_DrawingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{agent} redraws it as shapes, words and arrows you can edit" |
*
*/
export const canvas_pill_ink_drawing_title: ((inputs: Canvas_Pill_Ink_Drawing_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Ink_Drawing_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Send to {agent}" |
*
*/
export const canvas_pill_ink_send: ((inputs: Canvas_Pill_Ink_SendInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Ink_SendInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{agent} reads it and acts on it: what you wrote there is what it does" |
*
*/
export const canvas_pill_ink_send_title: ((inputs: Canvas_Pill_Ink_Send_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Ink_Send_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "More" |
*
*/
export const canvas_pill_more: ((inputs?: Canvas_Pill_MoreInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_MoreInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "More actions" |
*
*/
export const canvas_pill_more_actions: ((inputs?: Canvas_Pill_More_ActionsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_More_ActionsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "More card actions" |
*
*/
export const canvas_pill_more_card: ((inputs?: Canvas_Pill_More_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_More_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "New tab" |
*
*/
export const canvas_pill_new_tab: ((inputs?: Canvas_Pill_New_TabInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_New_TabInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open in a new tab" |
*
*/
export const canvas_pill_new_tab_title: ((inputs?: Canvas_Pill_New_Tab_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_New_Tab_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Reload" |
*
*/
export const canvas_pill_reload: ((inputs?: Canvas_Pill_ReloadInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_ReloadInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Reload the app in this window" |
*
*/
export const canvas_pill_reload_title: ((inputs?: Canvas_Pill_Reload_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Reload_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} stroke" |
* | "other" | "{count} strokes" |
*
*/
export const canvas_pill_strokes: ((inputs: Canvas_Pill_StrokesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_StrokesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the agent" |
*
*/
export const canvas_pill_the_agent: ((inputs?: Canvas_Pill_The_AgentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_The_AgentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Zoom to it" |
*
*/
export const canvas_pill_zoom_to: ((inputs?: Canvas_Pill_Zoom_ToInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Pill_Zoom_ToInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "An agent" |
*
*/
export const canvas_presence_agent: ((inputs?: Canvas_Presence_AgentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Presence_AgentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Someone elsewhere" |
*
*/
export const canvas_presence_elsewhere: ((inputs?: Canvas_Presence_ElsewhereInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Presence_ElsewhereInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Another window" |
*
*/
export const canvas_presence_window: ((inputs?: Canvas_Presence_WindowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Presence_WindowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Align" |
*
*/
export const canvas_props_align: ((inputs?: Canvas_Props_AlignInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_AlignInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Align bottoms" |
*
*/
export const canvas_props_align_bottom: ((inputs?: Canvas_Props_Align_BottomInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Align_BottomInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Align centres" |
*
*/
export const canvas_props_align_centre: ((inputs?: Canvas_Props_Align_CentreInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Align_CentreInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Align left edges" |
*
*/
export const canvas_props_align_left: ((inputs?: Canvas_Props_Align_LeftInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Align_LeftInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Align middles" |
*
*/
export const canvas_props_align_middle: ((inputs?: Canvas_Props_Align_MiddleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Align_MiddleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Align right edges" |
*
*/
export const canvas_props_align_right: ((inputs?: Canvas_Props_Align_RightInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Align_RightInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Align tops" |
*
*/
export const canvas_props_align_top: ((inputs?: Canvas_Props_Align_TopInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Align_TopInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Alignment" |
*
*/
export const canvas_props_alignment: ((inputs?: Canvas_Props_AlignmentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_AlignmentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Angle" |
*
*/
export const canvas_props_angle: ((inputs?: Canvas_Props_AngleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_AngleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Arrange" |
*
*/
export const canvas_props_arrange: ((inputs?: Canvas_Props_ArrangeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_ArrangeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Bend" |
*
*/
export const canvas_props_arrow_bend: ((inputs?: Canvas_Props_Arrow_BendInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_BendInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Automatic" |
*
*/
export const canvas_props_arrow_bend_auto: ((inputs?: Canvas_Props_Arrow_Bend_AutoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_Bend_AutoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Custom" |
*
*/
export const canvas_props_arrow_bend_custom: ((inputs?: Canvas_Props_Arrow_Bend_CustomInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_Bend_CustomInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Back to the automatic route" |
*
*/
export const canvas_props_arrow_bend_reset: ((inputs?: Canvas_Props_Arrow_Bend_ResetInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_Bend_ResetInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Curved" |
*
*/
export const canvas_props_arrow_curved: ((inputs?: Canvas_Props_Arrow_CurvedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_CurvedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Elbow" |
*
*/
export const canvas_props_arrow_elbow: ((inputs?: Canvas_Props_Arrow_ElbowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_ElbowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "nothing" |
*
*/
export const canvas_props_arrow_end_nothing: ((inputs?: Canvas_Props_Arrow_End_NothingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_End_NothingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "a point" |
*
*/
export const canvas_props_arrow_end_point: ((inputs?: Canvas_Props_Arrow_End_PointInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_End_PointInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "End side" |
*
*/
export const canvas_props_arrow_end_side: ((inputs?: Canvas_Props_Arrow_End_SideInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_End_SideInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "A head at both ends" |
*
*/
export const canvas_props_arrow_head_both: ((inputs?: Canvas_Props_Arrow_Head_BothInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_Head_BothInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "A head at the end" |
*
*/
export const canvas_props_arrow_head_end: ((inputs?: Canvas_Props_Arrow_Head_EndInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_Head_EndInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No head" |
*
*/
export const canvas_props_arrow_head_none: ((inputs?: Canvas_Props_Arrow_Head_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_Head_NoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Heads" |
*
*/
export const canvas_props_arrow_heads: ((inputs?: Canvas_Props_Arrow_HeadsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_HeadsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Middle" |
*
*/
export const canvas_props_arrow_middle: ((inputs?: Canvas_Props_Arrow_MiddleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_MiddleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Join at the middle of the side" |
*
*/
export const canvas_props_arrow_middle_title: ((inputs?: Canvas_Props_Arrow_Middle_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_Middle_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Route" |
*
*/
export const canvas_props_arrow_route: ((inputs?: Canvas_Props_Arrow_RouteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_RouteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Start side" |
*
*/
export const canvas_props_arrow_start_side: ((inputs?: Canvas_Props_Arrow_Start_SideInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_Start_SideInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Straight" |
*
*/
export const canvas_props_arrow_straight: ((inputs?: Canvas_Props_Arrow_StraightInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_StraightInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "On the middle of the line" |
*
*/
export const canvas_props_arrow_words_hint: ((inputs?: Canvas_Props_Arrow_Words_HintInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Arrow_Words_HintInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "At the bottom" |
*
*/
export const canvas_props_at_bottom: ((inputs?: Canvas_Props_At_BottomInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_At_BottomInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "In the middle" |
*
*/
export const canvas_props_at_middle: ((inputs?: Canvas_Props_At_MiddleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_At_MiddleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "At the top" |
*
*/
export const canvas_props_at_top: ((inputs?: Canvas_Props_At_TopInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_At_TopInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "auto" |
*
*/
export const canvas_props_auto: ((inputs?: Canvas_Props_AutoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_AutoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Blur" |
*
*/
export const canvas_props_blur: ((inputs?: Canvas_Props_BlurInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_BlurInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "blur" |
*
*/
export const canvas_props_blur_short: ((inputs?: Canvas_Props_Blur_ShortInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Blur_ShortInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Bold" |
*
*/
export const canvas_props_bold: ((inputs?: Canvas_Props_BoldInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_BoldInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close" |
*
*/
export const canvas_props_close: ((inputs?: Canvas_Props_CloseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_CloseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Colour" |
*
*/
export const canvas_props_colour: ((inputs?: Canvas_Props_ColourInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_ColourInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Corners" |
*
*/
export const canvas_props_corners: ((inputs?: Canvas_Props_CornersInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_CornersInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Dashed" |
*
*/
export const canvas_props_dash_dashed: ((inputs?: Canvas_Props_Dash_DashedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Dash_DashedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Dotted" |
*
*/
export const canvas_props_dash_dotted: ((inputs?: Canvas_Props_Dash_DottedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Dash_DottedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Solid" |
*
*/
export const canvas_props_dash_solid: ((inputs?: Canvas_Props_Dash_SolidInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Dash_SolidInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Dashes" |
*
*/
export const canvas_props_dashes: ((inputs?: Canvas_Props_DashesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_DashesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delete (Delete)" |
*
*/
export const canvas_props_delete: ((inputs?: Canvas_Props_DeleteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_DeleteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Let go of the selection" |
*
*/
export const canvas_props_deselect: ((inputs?: Canvas_Props_DeselectInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_DeselectInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Equal gaps across" |
*
*/
export const canvas_props_distribute_x: ((inputs?: Canvas_Props_Distribute_XInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Distribute_XInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Equal gaps down" |
*
*/
export const canvas_props_distribute_y: ((inputs?: Canvas_Props_Distribute_YInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Distribute_YInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Duplicate (⌘D)" |
*
*/
export const canvas_props_duplicate: ((inputs?: Canvas_Props_DuplicateInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_DuplicateInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shadow and blur" |
*
*/
export const canvas_props_effects: ((inputs?: Canvas_Props_EffectsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_EffectsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Export to Obsidian (.md)" |
*
*/
export const canvas_props_export_obsidian: ((inputs?: Canvas_Props_Export_ObsidianInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Export_ObsidianInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Export as a picture (PNG)" |
*
*/
export const canvas_props_export_png: ((inputs?: Canvas_Props_Export_PngInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Export_PngInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fill" |
*
*/
export const canvas_props_fill: ((inputs?: Canvas_Props_FillInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_FillInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fill colour" |
*
*/
export const canvas_props_fill_colour: ((inputs?: Canvas_Props_Fill_ColourInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Fill_ColourInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Linear" |
*
*/
export const canvas_props_fill_linear: ((inputs?: Canvas_Props_Fill_LinearInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Fill_LinearInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "None" |
*
*/
export const canvas_props_fill_none: ((inputs?: Canvas_Props_Fill_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Fill_NoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Radial" |
*
*/
export const canvas_props_fill_radial: ((inputs?: Canvas_Props_Fill_RadialInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Fill_RadialInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Solid" |
*
*/
export const canvas_props_fill_solid: ((inputs?: Canvas_Props_Fill_SolidInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Fill_SolidInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Flip across" |
*
*/
export const canvas_props_flip_x: ((inputs?: Canvas_Props_Flip_XInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Flip_XInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Flip up and down" |
*
*/
export const canvas_props_flip_y: ((inputs?: Canvas_Props_Flip_YInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Flip_YInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Font" |
*
*/
export const canvas_props_font: ((inputs?: Canvas_Props_FontInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_FontInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "size" |
*
*/
export const canvas_props_font_size: ((inputs?: Canvas_Props_Font_SizeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Font_SizeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "From" |
*
*/
export const canvas_props_from: ((inputs?: Canvas_Props_FromInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_FromInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Any Google font" |
*
*/
export const canvas_props_google_font: ((inputs?: Canvas_Props_Google_FontInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Google_FontInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Any family on Google Fonts, by its name" |
*
*/
export const canvas_props_google_font_title: ((inputs?: Canvas_Props_Google_Font_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Google_Font_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Icon colour" |
*
*/
export const canvas_props_icon_colour: ((inputs?: Canvas_Props_Icon_ColourInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Icon_ColourInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Library" |
*
*/
export const canvas_props_icon_library: ((inputs?: Canvas_Props_Icon_LibraryInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Icon_LibraryInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Icon name" |
*
*/
export const canvas_props_icon_name: ((inputs?: Canvas_Props_Icon_NameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Icon_NameInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pick…" |
*
*/
export const canvas_props_icon_pick: ((inputs?: Canvas_Props_Icon_PickInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Icon_PickInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pick another from the icons" |
*
*/
export const canvas_props_icon_pick_title: ((inputs?: Canvas_Props_Icon_Pick_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Icon_Pick_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Weight" |
*
*/
export const canvas_props_icon_weight: ((inputs?: Canvas_Props_Icon_WeightInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Icon_WeightInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Italic" |
*
*/
export const canvas_props_italic: ((inputs?: Canvas_Props_ItalicInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_ItalicInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} item" |
* | "other" | "{count} items" |
*
*/
export const canvas_props_items: ((inputs: Canvas_Props_ItemsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_ItemsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Keep the proportions" |
*
*/
export const canvas_props_keep_ratio: ((inputs?: Canvas_Props_Keep_RatioInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Keep_RatioInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Keeping the proportions" |
*
*/
export const canvas_props_keeping_ratio: ((inputs?: Canvas_Props_Keeping_RatioInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Keeping_RatioInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Arrow" |
*
*/
export const canvas_props_kind_arrow: ((inputs?: Canvas_Props_Kind_ArrowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Kind_ArrowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Card" |
*
*/
export const canvas_props_kind_card: ((inputs?: Canvas_Props_Kind_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Kind_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Ellipse" |
*
*/
export const canvas_props_kind_ellipse: ((inputs?: Canvas_Props_Kind_EllipseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Kind_EllipseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Frame" |
*
*/
export const canvas_props_kind_frame: ((inputs?: Canvas_Props_Kind_FrameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Kind_FrameInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Group" |
*
*/
export const canvas_props_kind_group: ((inputs?: Canvas_Props_Kind_GroupInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Kind_GroupInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Icon" |
*
*/
export const canvas_props_kind_icon: ((inputs?: Canvas_Props_Kind_IconInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Kind_IconInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Image" |
*
*/
export const canvas_props_kind_image: ((inputs?: Canvas_Props_Kind_ImageInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Kind_ImageInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Line" |
*
*/
export const canvas_props_kind_line: ((inputs?: Canvas_Props_Kind_LineInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Kind_LineInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Note" |
*
*/
export const canvas_props_kind_note: ((inputs?: Canvas_Props_Kind_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Kind_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Path" |
*
*/
export const canvas_props_kind_path: ((inputs?: Canvas_Props_Kind_PathInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Kind_PathInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Polygon" |
*
*/
export const canvas_props_kind_polygon: ((inputs?: Canvas_Props_Kind_PolygonInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Kind_PolygonInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Rectangle" |
*
*/
export const canvas_props_kind_rectangle: ((inputs?: Canvas_Props_Kind_RectangleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Kind_RectangleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shape" |
*
*/
export const canvas_props_kind_shape: ((inputs?: Canvas_Props_Kind_ShapeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Kind_ShapeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Text" |
*
*/
export const canvas_props_kind_text: ((inputs?: Canvas_Props_Kind_TextInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Kind_TextInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Layout" |
*
*/
export const canvas_props_layout: ((inputs?: Canvas_Props_LayoutInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_LayoutInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "space" |
*
*/
export const canvas_props_letter_spacing: ((inputs?: Canvas_Props_Letter_SpacingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Letter_SpacingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Line" |
*
*/
export const canvas_props_line: ((inputs?: Canvas_Props_LineInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_LineInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Where the line sits" |
*
*/
export const canvas_props_line_align: ((inputs?: Canvas_Props_Line_AlignInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Line_AlignInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Centre" |
*
*/
export const canvas_props_line_centre: ((inputs?: Canvas_Props_Line_CentreInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Line_CentreInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Line colour" |
*
*/
export const canvas_props_line_colour: ((inputs?: Canvas_Props_Line_ColourInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Line_ColourInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "line" |
*
*/
export const canvas_props_line_height: ((inputs?: Canvas_Props_Line_HeightInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Line_HeightInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Inside" |
*
*/
export const canvas_props_line_inside: ((inputs?: Canvas_Props_Line_InsideInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Line_InsideInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Outside" |
*
*/
export const canvas_props_line_outside: ((inputs?: Canvas_Props_Line_OutsideInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Line_OutsideInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Mixed" |
*
*/
export const canvas_props_mixed: ((inputs?: Canvas_Props_MixedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_MixedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Name" |
*
*/
export const canvas_props_name: ((inputs?: Canvas_Props_NameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_NameInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Opacity" |
*
*/
export const canvas_props_opacity: ((inputs?: Canvas_Props_OpacityInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_OpacityInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Order and actions" |
*
*/
export const canvas_props_order_actions: ((inputs?: Canvas_Props_Order_ActionsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Order_ActionsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Properties" |
*
*/
export const canvas_props_panel: ((inputs?: Canvas_Props_PanelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_PanelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Paper" |
*
*/
export const canvas_props_paper: ((inputs?: Canvas_Props_PaperInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_PaperInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pick any {what}" |
*
*/
export const canvas_props_pick_any: ((inputs: Canvas_Props_Pick_AnyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Pick_AnyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Position and size" |
*
*/
export const canvas_props_place: ((inputs?: Canvas_Props_PlaceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_PlaceInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "radius" |
*
*/
export const canvas_props_radius: ((inputs?: Canvas_Props_RadiusInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_RadiusInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Turn, in degrees" |
*
*/
export const canvas_props_rotation: ((inputs?: Canvas_Props_RotationInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_RotationInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Second colour" |
*
*/
export const canvas_props_second_colour: ((inputs?: Canvas_Props_Second_ColourInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Second_ColourInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shadow" |
*
*/
export const canvas_props_shadow: ((inputs?: Canvas_Props_ShadowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_ShadowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shadow colour" |
*
*/
export const canvas_props_shadow_colour: ((inputs?: Canvas_Props_Shadow_ColourInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Shadow_ColourInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shape" |
*
*/
export const canvas_props_shape: ((inputs?: Canvas_Props_ShapeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_ShapeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Kind" |
*
*/
export const canvas_props_shape_kind: ((inputs?: Canvas_Props_Shape_KindInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Shape_KindInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Kind of shape" |
*
*/
export const canvas_props_shape_kind_label: ((inputs?: Canvas_Props_Shape_Kind_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Shape_Kind_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Double-click the shape, or type here" |
*
*/
export const canvas_props_shape_words_hint: ((inputs?: Canvas_Props_Shape_Words_HintInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Shape_Words_HintInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Bottom" |
*
*/
export const canvas_props_side_bottom: ((inputs?: Canvas_Props_Side_BottomInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Side_BottomInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Left" |
*
*/
export const canvas_props_side_left: ((inputs?: Canvas_Props_Side_LeftInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Side_LeftInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Nearest side" |
*
*/
export const canvas_props_side_nearest: ((inputs?: Canvas_Props_Side_NearestInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Side_NearestInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Right" |
*
*/
export const canvas_props_side_right: ((inputs?: Canvas_Props_Side_RightInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Side_RightInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Top" |
*
*/
export const canvas_props_side_top: ((inputs?: Canvas_Props_Side_TopInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Side_TopInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "sides" |
*
*/
export const canvas_props_sides: ((inputs?: Canvas_Props_SidesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_SidesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sides and corners" |
*
*/
export const canvas_props_sides_corners: ((inputs?: Canvas_Props_Sides_CornersInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Sides_CornersInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "sprd" |
*
*/
export const canvas_props_spread_short: ((inputs?: Canvas_Props_Spread_ShortInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Spread_ShortInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Style" |
*
*/
export const canvas_props_style: ((inputs?: Canvas_Props_StyleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_StyleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{label} {color}" |
*
*/
export const canvas_props_swatch: ((inputs: Canvas_Props_SwatchInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_SwatchInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Text colour" |
*
*/
export const canvas_props_text_colour: ((inputs?: Canvas_Props_Text_ColourInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Text_ColourInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "To" |
*
*/
export const canvas_props_to: ((inputs?: Canvas_Props_ToInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_ToInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Send to the back" |
*
*/
export const canvas_props_to_back: ((inputs?: Canvas_Props_To_BackInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_To_BackInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Bring to the front" |
*
*/
export const canvas_props_to_front: ((inputs?: Canvas_Props_To_FrontInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_To_FrontInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Up and down" |
*
*/
export const canvas_props_vertical: ((inputs?: Canvas_Props_VerticalInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_VerticalInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Width" |
*
*/
export const canvas_props_width: ((inputs?: Canvas_Props_WidthInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_WidthInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Words" |
*
*/
export const canvas_props_words: ((inputs?: Canvas_Props_WordsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_WordsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Words in the shape" |
*
*/
export const canvas_props_words_in_shape: ((inputs?: Canvas_Props_Words_In_ShapeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Props_Words_In_ShapeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Redo" |
*
*/
export const canvas_redo: ((inputs?: Canvas_RedoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_RedoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Redo (⇧⌘Z)" |
*
*/
export const canvas_redo_title: ((inputs?: Canvas_Redo_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Redo_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Arrow both" |
*
*/
export const canvas_shape_arrow_both: ((inputs?: Canvas_Shape_Arrow_BothInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_Arrow_BothInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Arrow right" |
*
*/
export const canvas_shape_arrow_right: ((inputs?: Canvas_Shape_Arrow_RightInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_Arrow_RightInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Brace" |
*
*/
export const canvas_shape_brace: ((inputs?: Canvas_Shape_BraceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_BraceInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Card" |
*
*/
export const canvas_shape_card: ((inputs?: Canvas_Shape_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Chevron" |
*
*/
export const canvas_shape_chevron: ((inputs?: Canvas_Shape_ChevronInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_ChevronInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cloud" |
*
*/
export const canvas_shape_cloud: ((inputs?: Canvas_Shape_CloudInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_CloudInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Data" |
*
*/
export const canvas_shape_data: ((inputs?: Canvas_Shape_DataInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_DataInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Database" |
*
*/
export const canvas_shape_database: ((inputs?: Canvas_Shape_DatabaseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_DatabaseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Decision" |
*
*/
export const canvas_shape_decision: ((inputs?: Canvas_Shape_DecisionInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_DecisionInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delay" |
*
*/
export const canvas_shape_delay: ((inputs?: Canvas_Shape_DelayInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_DelayInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Diamond" |
*
*/
export const canvas_shape_diamond: ((inputs?: Canvas_Shape_DiamondInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_DiamondInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Document" |
*
*/
export const canvas_shape_document: ((inputs?: Canvas_Shape_DocumentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_DocumentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Ellipse" |
*
*/
export const canvas_shape_ellipse: ((inputs?: Canvas_Shape_EllipseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_EllipseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Arrows and callouts" |
*
*/
export const canvas_shape_group_arrows: ((inputs?: Canvas_Shape_Group_ArrowsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_Group_ArrowsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Basic" |
*
*/
export const canvas_shape_group_basic: ((inputs?: Canvas_Shape_Group_BasicInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_Group_BasicInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Flowchart" |
*
*/
export const canvas_shape_group_flowchart: ((inputs?: Canvas_Shape_Group_FlowchartInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_Group_FlowchartInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Heart" |
*
*/
export const canvas_shape_heart: ((inputs?: Canvas_Shape_HeartInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_HeartInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Hexagon" |
*
*/
export const canvas_shape_hexagon: ((inputs?: Canvas_Shape_HexagonInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_HexagonInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Manual input" |
*
*/
export const canvas_shape_manual_input: ((inputs?: Canvas_Shape_Manual_InputInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_Manual_InputInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Octagon" |
*
*/
export const canvas_shape_octagon: ((inputs?: Canvas_Shape_OctagonInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_OctagonInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Off-page" |
*
*/
export const canvas_shape_off_page: ((inputs?: Canvas_Shape_Off_PageInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_Off_PageInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Parallelogram" |
*
*/
export const canvas_shape_parallelogram: ((inputs?: Canvas_Shape_ParallelogramInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_ParallelogramInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pentagon" |
*
*/
export const canvas_shape_pentagon: ((inputs?: Canvas_Shape_PentagonInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_PentagonInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Plus" |
*
*/
export const canvas_shape_plus: ((inputs?: Canvas_Shape_PlusInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_PlusInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Predefined" |
*
*/
export const canvas_shape_predefined: ((inputs?: Canvas_Shape_PredefinedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_PredefinedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Preparation" |
*
*/
export const canvas_shape_preparation: ((inputs?: Canvas_Shape_PreparationInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_PreparationInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Process" |
*
*/
export const canvas_shape_process: ((inputs?: Canvas_Shape_ProcessInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_ProcessInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Rectangle" |
*
*/
export const canvas_shape_rectangle: ((inputs?: Canvas_Shape_RectangleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_RectangleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Ring" |
*
*/
export const canvas_shape_ring: ((inputs?: Canvas_Shape_RingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_RingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Rounded" |
*
*/
export const canvas_shape_rounded: ((inputs?: Canvas_Shape_RoundedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_RoundedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Speech" |
*
*/
export const canvas_shape_speech: ((inputs?: Canvas_Shape_SpeechInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_SpeechInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Star" |
*
*/
export const canvas_shape_star: ((inputs?: Canvas_Shape_StarInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_StarInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Terminator" |
*
*/
export const canvas_shape_terminator: ((inputs?: Canvas_Shape_TerminatorInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_TerminatorInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Trapezoid" |
*
*/
export const canvas_shape_trapezoid: ((inputs?: Canvas_Shape_TrapezoidInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_TrapezoidInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Triangle" |
*
*/
export const canvas_shape_triangle: ((inputs?: Canvas_Shape_TriangleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Shape_TriangleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The stage could not start: {why}" |
*
*/
export const canvas_stage_failed: ((inputs: Canvas_Stage_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Stage_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This browser can't draw the stage: it needs WebGPU or WebGL 2." |
*
*/
export const canvas_stage_no_backend: ((inputs?: Canvas_Stage_No_BackendInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Stage_No_BackendInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Arrow: drag from one thing to another and it stays joined" |
*
*/
export const canvas_tool_arrow: ((inputs?: Canvas_Tool_ArrowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Tool_ArrowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Card: write markdown, see headings, lists, bold and links" |
*
*/
export const canvas_tool_card: ((inputs?: Canvas_Tool_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Tool_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Add a file" |
*
*/
export const canvas_tool_file: ((inputs?: Canvas_Tool_FileInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Tool_FileInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "A file: a document, a picture, a film, a sound, anything" |
*
*/
export const canvas_tool_file_title: ((inputs?: Canvas_Tool_File_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Tool_File_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Frame: a box that holds what is drawn inside it" |
*
*/
export const canvas_tool_frame: ((inputs?: Canvas_Tool_FrameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Tool_FrameInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Icons: Lucide, Phosphor, Material and Feather" |
*
*/
export const canvas_tool_icons: ((inputs?: Canvas_Tool_IconsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Tool_IconsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Note" |
*
*/
export const canvas_tool_note: ((inputs?: Canvas_Tool_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Tool_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shapes: basic, flowchart, arrows and callouts" |
*
*/
export const canvas_tool_shapes: ((inputs?: Canvas_Tool_ShapesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Tool_ShapesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Text" |
*
*/
export const canvas_tool_text: ((inputs?: Canvas_Tool_TextInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Tool_TextInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{label} ({key})" |
*
*/
export const canvas_tool_with_key: ((inputs: Canvas_Tool_With_KeyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Tool_With_KeyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Drag to move; throw at either edge to put away; double-click to put back" |
*
*/
export const canvas_tools_grip: ((inputs?: Canvas_Tools_GripInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Tools_GripInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Drawing tools" |
*
*/
export const canvas_tools_label: ((inputs?: Canvas_Tools_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Tools_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Undo your last change to the drawing (⌘Z)" |
*
*/
export const canvas_tools_undo_title: ((inputs?: Canvas_Tools_Undo_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Tools_Undo_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Bring the drawing tools back" |
*
*/
export const canvas_tools_unstow: ((inputs?: Canvas_Tools_UnstowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_Tools_UnstowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Undo" |
*
*/
export const canvas_undo: ((inputs?: Canvas_UndoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvas_UndoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "All canvases" |
*
*/
export const canvases_all: ((inputs?: Canvases_AllInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_AllInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Allow" |
*
*/
export const canvases_ask_allow: ((inputs?: Canvases_Ask_AllowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ask_AllowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "an agent" |
*
*/
export const canvases_ask_an_agent: ((inputs?: Canvases_Ask_An_AgentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ask_An_AgentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{card} wants to start a new agent called {name}." |
*
*/
export const canvases_ask_create: ((inputs: Canvases_Ask_CreateInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ask_CreateInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Don't allow" |
*
*/
export const canvases_ask_deny: ((inputs?: Canvases_Ask_DenyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ask_DenyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{card} wants to give {agent} this task: “{task}”." |
*
*/
export const canvases_ask_queue: ((inputs: Canvases_Ask_QueueInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ask_QueueInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{card} wants to send {agent} this message now: “{task}”." |
*
*/
export const canvases_ask_send: ((inputs: Canvases_Ask_SendInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ask_SendInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "something" |
*
*/
export const canvases_ask_something: ((inputs?: Canvases_Ask_SomethingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ask_SomethingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Let this card message an agent?" |
*
*/
export const canvases_ask_title: ((inputs?: Canvases_Ask_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ask_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "A–Z" |
*
*/
export const canvases_az: ((inputs?: Canvases_AzInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_AzInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cancel" |
*
*/
export const canvases_cancel: ((inputs?: Canvases_CancelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_CancelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Canvases" |
*
*/
export const canvases_canvases: ((inputs?: Canvases_CanvasesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_CanvasesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{title}: {meta}" |
*
*/
export const canvases_card_title: ((inputs: Canvases_Card_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Card_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{title}: {meta}, you are here" |
*
*/
export const canvases_card_title_here: ((inputs: Canvases_Card_Title_HereInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Card_Title_HereInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{title}: {meta}, nobody on it" |
*
*/
export const canvases_card_title_nobody: ((inputs: Canvases_Card_Title_NobodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Card_Title_NobodyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close" |
*
*/
export const canvases_close: ((inputs?: Canvases_CloseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_CloseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Make a copy" |
*
*/
export const canvases_copy: ((inputs?: Canvases_CopyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_CopyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Make a copy of {title}" |
*
*/
export const canvases_copy_label: ((inputs: Canvases_Copy_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Copy_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Create" |
*
*/
export const canvases_create: ((inputs?: Canvases_CreateInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_CreateInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Current" |
*
*/
export const canvases_current: ((inputs?: Canvases_CurrentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_CurrentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delete" |
*
*/
export const canvases_delete: ((inputs?: Canvases_DeleteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_DeleteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delete canvas" |
*
*/
export const canvases_delete_canvas: ((inputs?: Canvases_Delete_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Delete_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delete {title}" |
*
*/
export const canvases_delete_label: ((inputs: Canvases_Delete_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Delete_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Deletes the canvas, its drawing and the cards kept in its own folder." |
*
*/
export const canvases_delete_title: ((inputs?: Canvases_Delete_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Delete_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Empty canvas" |
*
*/
export const canvases_empty: ((inputs?: Canvases_EmptyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_EmptyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Find a canvas" |
*
*/
export const canvases_find: ((inputs?: Canvases_FindInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_FindInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No canvas matches that" |
*
*/
export const canvases_find_none: ((inputs?: Canvases_Find_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Find_NoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No canvas matches “{query}”." |
*
*/
export const canvases_find_none_query: ((inputs: Canvases_Find_None_QueryInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Find_None_QueryInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Matches a canvas's name, the words on its cards and notes, and who is on it" |
*
*/
export const canvases_find_title: ((inputs?: Canvases_Find_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Find_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Keep it" |
*
*/
export const canvases_keep: ((inputs?: Canvases_KeepInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_KeepInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{shown} card" |
* | "other" | "{shown} cards" |
*
*/
export const canvases_meta_cards: ((inputs: Canvases_Meta_CardsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Meta_CardsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Empty" |
*
*/
export const canvases_meta_empty: ((inputs?: Canvases_Meta_EmptyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Meta_EmptyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Name the new canvas" |
*
*/
export const canvases_name_new: ((inputs?: Canvases_Name_NewInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Name_NewInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "New canvas" |
*
*/
export const canvases_new: ((inputs?: Canvases_NewInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_NewInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "New name for {title}" |
*
*/
export const canvases_new_name: ((inputs: Canvases_New_NameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_New_NameInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No picture yet" |
*
*/
export const canvases_no_picture: ((inputs?: Canvases_No_PictureInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_No_PictureInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open {title}" |
*
*/
export const canvases_open: ((inputs: Canvases_OpenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_OpenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "a note · a card · words · an arrow" |
*
*/
export const canvases_ops_a_note_a_card_words: ((inputs?: Canvases_Ops_A_Note_A_Card_WordsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_A_Note_A_Card_WordsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "a pencil" |
*
*/
export const canvases_ops_a_pencil: ((inputs?: Canvases_Ops_A_PencilInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_A_PencilInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "a rectangle · an ellipse · a frame" |
*
*/
export const canvases_ops_a_rectangle_an_ellipse_a: ((inputs?: Canvases_Ops_A_Rectangle_An_Ellipse_AInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_A_Rectangle_An_Ellipse_AInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "add a photo or a file to the deck" |
*
*/
export const canvases_ops_add_a_photo_or_a: ((inputs?: Canvases_Ops_Add_A_Photo_Or_AInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Add_A_Photo_Or_AInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "always the canvas, even while drawing" |
*
*/
export const canvases_ops_always_the_canvas_even_while: ((inputs?: Canvases_Ops_Always_The_Canvas_Even_WhileInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Always_The_Canvas_Even_WhileInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cards and the conversation" |
*
*/
export const canvases_ops_cards_and_the_conversation: ((inputs?: Canvases_Ops_Cards_And_The_ConversationInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Cards_And_The_ConversationInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Changing a component" |
*
*/
export const canvases_ops_changing_a_component: ((inputs?: Canvases_Ops_Changing_A_ComponentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Changing_A_ComponentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "click" |
*
*/
export const canvases_ops_click: ((inputs?: Canvases_Ops_ClickInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_ClickInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "click a turn on the right spine" |
*
*/
export const canvases_ops_click_a_turn_on_the: ((inputs?: Canvases_Ops_Click_A_Turn_On_TheInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Click_A_Turn_On_TheInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "commands, in the input bar" |
*
*/
export const canvases_ops_commands_in_the_input_bar: ((inputs?: Canvases_Ops_Commands_In_The_Input_BarInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Commands_In_The_Input_BarInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "comment on them: kept in the input bar for your next message, or sent now" |
*
*/
export const canvases_ops_comment_on_them_kept_in: ((inputs?: Canvases_Ops_Comment_On_Them_Kept_InInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Comment_On_Them_Kept_InInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "delete it" |
*
*/
export const canvases_ops_delete_it: ((inputs?: Canvases_Ops_Delete_ItInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Delete_ItInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "delete the strokes the lasso holds" |
*
*/
export const canvases_ops_delete_the_strokes_the_lasso: ((inputs?: Canvases_Ops_Delete_The_Strokes_The_LassoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Delete_The_Strokes_The_LassoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "double-click" |
*
*/
export const canvases_ops_double_click: ((inputs?: Canvases_Ops_Double_ClickInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Double_ClickInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "drag" |
*
*/
export const canvases_ops_drag: ((inputs?: Canvases_Ops_DragInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_DragInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "drag a card's title" |
*
*/
export const canvases_ops_drag_a_card_s_title: ((inputs?: Canvases_Ops_Drag_A_Card_S_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Drag_A_Card_S_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "drag a selected component" |
*
*/
export const canvases_ops_drag_a_selected_component: ((inputs?: Canvases_Ops_Drag_A_Selected_ComponentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Drag_A_Selected_ComponentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "drag · drag the corner" |
*
*/
export const canvases_ops_drag_drag_the_corner: ((inputs?: Canvases_Ops_Drag_Drag_The_CornerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Drag_Drag_The_CornerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "drag inside an embed" |
*
*/
export const canvases_ops_drag_inside_an_embed: ((inputs?: Canvases_Ops_Drag_Inside_An_EmbedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Drag_Inside_An_EmbedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "draw on the card: pen, marker, eraser, lasso" |
*
*/
export const canvases_ops_draw_on_the_card_pen: ((inputs?: Canvases_Ops_Draw_On_The_Card_PenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Draw_On_The_Card_PenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Drawing" |
*
*/
export const canvases_ops_drawing: ((inputs?: Canvases_Ops_DrawingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_DrawingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "draws with its pressure, and from then on a finger moves the canvas" |
*
*/
export const canvases_ops_draws_with_its_pressure_and: ((inputs?: Canvases_Ops_Draws_With_Its_Pressure_AndInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Draws_With_Its_Pressure_AndInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "drop a file on a card" |
*
*/
export const canvases_ops_drop_a_file_on_a: ((inputs?: Canvases_Ops_Drop_A_File_On_AInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Drop_A_File_On_AInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "duplicate it" |
*
*/
export const canvases_ops_duplicate_it: ((inputs?: Canvases_Ops_Duplicate_ItInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Duplicate_ItInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "embed it where it landed" |
*
*/
export const canvases_ops_embed_it_where_it_landed: ((inputs?: Canvases_Ops_Embed_It_Where_It_LandedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Embed_It_Where_It_LandedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "every card in the deck, searchable" |
*
*/
export const canvases_ops_every_card_in_the_deck: ((inputs?: Canvases_Ops_Every_Card_In_The_DeckInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Every_Card_In_The_DeckInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "fit everything on the canvas on screen" |
*
*/
export const canvases_ops_fit_everything_on_the_canvas: ((inputs?: Canvases_Ops_Fit_Everything_On_The_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Fit_Everything_On_The_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "fit the selected card" |
*
*/
export const canvases_ops_fit_the_selected_card: ((inputs?: Canvases_Ops_Fit_The_Selected_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Fit_The_Selected_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Zoomed out far enough, a card is a picture on a map: drag it to move it. The card you select keeps its page, and works at any zoom." |
*
*/
export const canvases_ops_footer: ((inputs?: Canvases_Ops_FooterInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_FooterInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "from this device, in the picker" |
*
*/
export const canvases_ops_from_this_device_in_the: ((inputs?: Canvases_Ops_From_This_Device_In_TheInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_From_This_Device_In_TheInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "kind, tone, order, duplicate, delete" |
*
*/
export const canvases_ops_kind_tone_order_duplicate_delete: ((inputs?: Canvases_Ops_Kind_Tone_Order_Duplicate_DeleteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Kind_Tone_Order_Duplicate_DeleteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "let the selection go" |
*
*/
export const canvases_ops_let_the_selection_go: ((inputs?: Canvases_Ops_Let_The_Selection_GoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Let_The_Selection_GoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "move it" |
*
*/
export const canvases_ops_move_it: ((inputs?: Canvases_Ops_Move_ItInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Move_ItInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "move it · resize it" |
*
*/
export const canvases_ops_move_it_resize_it: ((inputs?: Canvases_Ops_Move_It_Resize_ItInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Move_It_Resize_ItInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "move the card" |
*
*/
export const canvases_ops_move_the_card: ((inputs?: Canvases_Ops_Move_The_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Move_The_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Moving around" |
*
*/
export const canvases_ops_moving_around: ((inputs?: Canvases_Ops_Moving_AroundInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Moving_AroundInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "@Name" |
*
*/
export const canvases_ops_name: ((inputs?: Canvases_Ops_NameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_NameInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "nudge · nudge by ten" |
*
*/
export const canvases_ops_nudge_nudge_by_ten: ((inputs?: Canvases_Ops_Nudge_Nudge_By_TenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Nudge_Nudge_By_TenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "pan from anywhere, including over a card" |
*
*/
export const canvases_ops_pan_from_anywhere_including_over: ((inputs?: Canvases_Ops_Pan_From_Anywhere_Including_OverInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Pan_From_Anywhere_Including_OverInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "pan the canvas" |
*
*/
export const canvases_ops_pan_the_canvas: ((inputs?: Canvases_Ops_Pan_The_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Pan_The_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "pick a tool, then tap" |
*
*/
export const canvases_ops_pick_a_tool_then_tap: ((inputs?: Canvases_Ops_Pick_A_Tool_Then_TapInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Pick_A_Tool_Then_TapInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "pinch" |
*
*/
export const canvases_ops_pinch: ((inputs?: Canvases_Ops_PinchInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_PinchInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "pinch · ⌘-wheel" |
*
*/
export const canvases_ops_pinch_wheel: ((inputs?: Canvases_Ops_Pinch_WheelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Pinch_WheelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "place a sticky, card, text or embed" |
*
*/
export const canvases_ops_place_a_sticky_card_text: ((inputs?: Canvases_Ops_Place_A_Sticky_Card_TextInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Place_A_Sticky_Card_TextInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "put it away" |
*
*/
export const canvases_ops_put_it_away: ((inputs?: Canvases_Ops_Put_It_AwayInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Put_It_AwayInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "put the pen down" |
*
*/
export const canvases_ops_put_the_pen_down: ((inputs?: Canvases_Ops_Put_The_Pen_DownInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Put_The_Pen_DownInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Reading a card" |
*
*/
export const canvases_ops_reading_a_card: ((inputs?: Canvases_Ops_Reading_A_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Reading_A_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "retype its words in place" |
*
*/
export const canvases_ops_retype_its_words_in_place: ((inputs?: Canvases_Ops_Retype_Its_Words_In_PlaceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Retype_Its_Words_In_PlaceInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "scrolls the embed, not the canvas" |
*
*/
export const canvases_ops_scrolls_the_embed_not_the: ((inputs?: Canvases_Ops_Scrolls_The_Embed_Not_TheInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Scrolls_The_Embed_Not_TheInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "select, drag and resize" |
*
*/
export const canvases_ops_select_drag_and_resize: ((inputs?: Canvases_Ops_Select_Drag_And_ResizeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Select_Drag_And_ResizeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "select it" |
*
*/
export const canvases_ops_select_it: ((inputs?: Canvases_Ops_Select_ItInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Select_ItInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "select words" |
*
*/
export const canvases_ops_select_words: ((inputs?: Canvases_Ops_Select_WordsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Select_WordsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "send behind · bring in front" |
*
*/
export const canvases_ops_send_behind_bring_in_front: ((inputs?: Canvases_Ops_Send_Behind_Bring_In_FrontInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Send_Behind_Bring_In_FrontInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "send the line to that agent, without leaving this canvas" |
*
*/
export const canvases_ops_send_the_line_to_that: ((inputs?: Canvases_Ops_Send_The_Line_To_ThatInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Send_The_Line_To_ThatInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shortcuts" |
*
*/
export const canvases_ops_shortcuts: ((inputs?: Canvases_Ops_ShortcutsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_ShortcutsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "space-drag" |
*
*/
export const canvases_ops_space_drag: ((inputs?: Canvases_Ops_Space_DragInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Space_DragInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "swipe in from the left edge" |
*
*/
export const canvases_ops_swipe_in_from_the_left: ((inputs?: Canvases_Ops_Swipe_In_From_The_LeftInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Swipe_In_From_The_LeftInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "swipe in from the right edge" |
*
*/
export const canvases_ops_swipe_in_from_the_right: ((inputs?: Canvases_Ops_Swipe_In_From_The_RightInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Swipe_In_From_The_RightInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "swipe the conversation right" |
*
*/
export const canvases_ops_swipe_the_conversation_right: ((inputs?: Canvases_Ops_Swipe_The_Conversation_RightInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Swipe_The_Conversation_RightInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "take it off the canvas, keeping it in context" |
*
*/
export const canvases_ops_take_it_off_the_canvas: ((inputs?: Canvases_Ops_Take_It_Off_The_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Take_It_Off_The_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "tap" |
*
*/
export const canvases_ops_tap: ((inputs?: Canvases_Ops_TapInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_TapInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "tap again" |
*
*/
export const canvases_ops_tap_again: ((inputs?: Canvases_Ops_Tap_AgainInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Tap_AgainInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the agents · the cards they are holding" |
*
*/
export const canvases_ops_the_agents_the_cards_they: ((inputs?: Canvases_Ops_The_Agents_The_Cards_TheyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_The_Agents_The_Cards_TheyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the brush" |
*
*/
export const canvases_ops_the_brush: ((inputs?: Canvases_Ops_The_BrushInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_The_BrushInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the card's ×" |
*
*/
export const canvases_ops_the_card_s: ((inputs?: Canvases_Ops_The_Card_SInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_The_Card_SInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the cards and agents rail" |
*
*/
export const canvases_ops_the_cards_and_agents_rail: ((inputs?: Canvases_Ops_The_Cards_And_Agents_RailInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_The_Cards_And_Agents_RailInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the conversation" |
*
*/
export const canvases_ops_the_conversation: ((inputs?: Canvases_Ops_The_ConversationInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_The_ConversationInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the conversation at that turn" |
*
*/
export const canvases_ops_the_conversation_at_that_turn: ((inputs?: Canvases_Ops_The_Conversation_At_That_TurnInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_The_Conversation_At_That_TurnInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the conversation, opened and closed" |
*
*/
export const canvases_ops_the_conversation_opened_and_closed: ((inputs?: Canvases_Ops_The_Conversation_Opened_And_ClosedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_The_Conversation_Opened_And_ClosedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the grid button" |
*
*/
export const canvases_ops_the_grid_button: ((inputs?: Canvases_Ops_The_Grid_ButtonInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_The_Grid_ButtonInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the panel buttons" |
*
*/
export const canvases_ops_the_panel_buttons: ((inputs?: Canvases_Ops_The_Panel_ButtonsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_The_Panel_ButtonsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the properties sheet" |
*
*/
export const canvases_ops_the_properties_sheet: ((inputs?: Canvases_Ops_The_Properties_SheetInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_The_Properties_SheetInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the same two panels, either way" |
*
*/
export const canvases_ops_the_same_two_panels_either: ((inputs?: Canvases_Ops_The_Same_Two_Panels_EitherInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_The_Same_Two_Panels_EitherInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the speech-bubble button" |
*
*/
export const canvases_ops_the_speech_bubble_button: ((inputs?: Canvases_Ops_The_Speech_Bubble_ButtonInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_The_Speech_Bubble_ButtonInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the two title-bar buttons" |
*
*/
export const canvases_ops_the_two_title_bar_buttons: ((inputs?: Canvases_Ops_The_Two_Title_Bar_ButtonsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_The_Two_Title_Bar_ButtonsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "two-finger scroll" |
*
*/
export const canvases_ops_two_finger_scroll: ((inputs?: Canvases_Ops_Two_Finger_ScrollInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Two_Finger_ScrollInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "two fingers" |
*
*/
export const canvases_ops_two_fingers: ((inputs?: Canvases_Ops_Two_FingersInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Two_FingersInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "undo on this card" |
*
*/
export const canvases_ops_undo_on_this_card: ((inputs?: Canvases_Ops_Undo_On_This_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Undo_On_This_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "undo · redo a stroke, while drawing" |
*
*/
export const canvases_ops_undo_redo_a_stroke_while: ((inputs?: Canvases_Ops_Undo_Redo_A_Stroke_WhileInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Undo_Redo_A_Stroke_WhileInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "zoom about the centre" |
*
*/
export const canvases_ops_zoom_about_the_centre: ((inputs?: Canvases_Ops_Zoom_About_The_CentreInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Zoom_About_The_CentreInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "zoom about the fingers" |
*
*/
export const canvases_ops_zoom_about_the_fingers: ((inputs?: Canvases_Ops_Zoom_About_The_FingersInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Zoom_About_The_FingersInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "zoom about the pointer" |
*
*/
export const canvases_ops_zoom_about_the_pointer: ((inputs?: Canvases_Ops_Zoom_About_The_PointerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Ops_Zoom_About_The_PointerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Order" |
*
*/
export const canvases_order: ((inputs?: Canvases_OrderInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_OrderInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Recent" |
*
*/
export const canvases_recent: ((inputs?: Canvases_RecentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_RecentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Rename" |
*
*/
export const canvases_rename: ((inputs?: Canvases_RenameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_RenameInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Rename {title}" |
*
*/
export const canvases_rename_label: ((inputs: Canvases_Rename_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Rename_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shared by {owner}" |
*
*/
export const canvases_shared_by: ((inputs: Canvases_Shared_ByInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Shared_ByInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shared by {owner}, to view" |
*
*/
export const canvases_shared_by_view: ((inputs: Canvases_Shared_By_ViewInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Canvases_Shared_By_ViewInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "An agent asks you something" |
*
*/
export const chat_alert_ask: ((inputs?: Chat_Alert_AskInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Alert_AskInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "It waits until you answer." |
*
*/
export const chat_alert_ask_note: ((inputs?: Chat_Alert_Ask_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Alert_Ask_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "An agent finishes" |
*
*/
export const chat_alert_done: ((inputs?: Chat_Alert_DoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Alert_DoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "It left you something to read." |
*
*/
export const chat_alert_done_note: ((inputs?: Chat_Alert_Done_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Alert_Done_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Something goes wrong" |
*
*/
export const chat_alert_problem: ((inputs?: Chat_Alert_ProblemInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Alert_ProblemInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "A turn failed, or an edit was refused." |
*
*/
export const chat_alert_problem_note: ((inputs?: Chat_Alert_Problem_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Alert_Problem_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Conversation history" |
*
*/
export const chat_conversation_history: ((inputs?: Chat_Conversation_HistoryInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Conversation_HistoryInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} earlier message" |
* | "other" | "{count} earlier messages" |
*
*/
export const chat_earlier_count: ((inputs: Chat_Earlier_CountInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Earlier_CountInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Earlier messages" |
*
*/
export const chat_earlier_messages: ((inputs?: Chat_Earlier_MessagesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Earlier_MessagesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Nothing said yet. Ask for something and it will show up here." |
*
*/
export const chat_empty: ((inputs?: Chat_EmptyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_EmptyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fork" |
*
*/
export const chat_fork: ((inputs?: Chat_ForkInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_ForkInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fork from here" |
*
*/
export const chat_fork_label: ((inputs?: Chat_Fork_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Fork_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fork from here: a new conversation that remembers everything up to this message" |
*
*/
export const chat_fork_title: ((inputs?: Chat_Fork_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Fork_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Hide the conversation" |
*
*/
export const chat_hide_conversation: ((inputs?: Chat_Hide_ConversationInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Hide_ConversationInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "hide thinking" |
*
*/
export const chat_hide_thinking: ((inputs?: Chat_Hide_ThinkingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Hide_ThinkingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Latest messages" |
*
*/
export const chat_latest_messages: ((inputs?: Chat_Latest_MessagesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Latest_MessagesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "As shown" |
*
*/
export const chat_pill_as_shown: ((inputs?: Chat_Pill_As_ShownInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Pill_As_ShownInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close" |
*
*/
export const chat_pill_close: ((inputs?: Chat_Pill_CloseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Pill_CloseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Exact text" |
*
*/
export const chat_pill_exact_text: ((inputs?: Chat_Pill_Exact_TextInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Pill_Exact_TextInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} — open the file" |
*
*/
export const chat_pill_open_file: ((inputs: Chat_Pill_Open_FileInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Pill_Open_FileInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Remove" |
*
*/
export const chat_pill_remove: ((inputs?: Chat_Pill_RemoveInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Pill_RemoveInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} — show it on the canvas" |
*
*/
export const chat_pill_show_on_canvas: ((inputs: Chat_Pill_Show_On_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Pill_Show_On_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{source} · click to read all" |
*
*/
export const chat_pill_sub: ((inputs: Chat_Pill_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Pill_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} · {source} · click to read all" |
*
*/
export const chat_pill_sub_named: ((inputs: Chat_Pill_Sub_NamedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Pill_Sub_NamedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Rewind" |
*
*/
export const chat_rewind: ((inputs?: Chat_RewindInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_RewindInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Rewind to here" |
*
*/
export const chat_rewind_label: ((inputs?: Chat_Rewind_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Rewind_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Rewind to here: take back everything after it, and these words go back into the input bar" |
*
*/
export const chat_rewind_title: ((inputs?: Chat_Rewind_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Rewind_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "running tools…" |
*
*/
export const chat_running_tools: ((inputs?: Chat_Running_ToolsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Running_ToolsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Scroll to the latest messages" |
*
*/
export const chat_scroll_latest: ((inputs?: Chat_Scroll_LatestInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Scroll_LatestInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show the conversation" |
*
*/
export const chat_show_conversation: ((inputs?: Chat_Show_ConversationInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Show_ConversationInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Silent" |
*
*/
export const chat_sound_silent: ((inputs?: Chat_Sound_SilentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Sound_SilentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "streaming" |
*
*/
export const chat_state_streaming: ((inputs?: Chat_State_StreamingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_State_StreamingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "thinking" |
*
*/
export const chat_state_thinking: ((inputs?: Chat_State_ThinkingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_State_ThinkingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "tool" |
*
*/
export const chat_state_tool: ((inputs?: Chat_State_ToolInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_State_ToolInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "waiting" |
*
*/
export const chat_state_waiting: ((inputs?: Chat_State_WaitingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_State_WaitingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The conversation" |
*
*/
export const chat_the_conversation: ((inputs?: Chat_The_ConversationInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_The_ConversationInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "thinking…" |
*
*/
export const chat_thinking: ((inputs?: Chat_ThinkingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_ThinkingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Keep this history and start a second agent from this point." |
*
*/
export const chat_tm_fork_note: ((inputs?: Chat_Tm_Fork_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tm_Fork_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Go back to this message" |
*
*/
export const chat_tm_go_back: ((inputs?: Chat_Tm_Go_BackInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tm_Go_BackInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Preview" |
*
*/
export const chat_tm_preview: ((inputs?: Chat_Tm_PreviewInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tm_PreviewInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show the canvas as it was at this message. Nothing is written, and Escape puts it back." |
*
*/
export const chat_tm_preview_note: ((inputs?: Chat_Tm_Preview_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tm_Preview_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Restore" |
*
*/
export const chat_tm_restore: ((inputs?: Chat_Tm_RestoreInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tm_RestoreInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Write the boards back to how they were here. The conversation stays where it is." |
*
*/
export const chat_tm_restore_note: ((inputs?: Chat_Tm_Restore_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tm_Restore_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Take back everything after it, and these words go back into the input bar." |
*
*/
export const chat_tm_rewind_note: ((inputs?: Chat_Tm_Rewind_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tm_Rewind_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Stop previewing" |
*
*/
export const chat_tm_stop_previewing: ((inputs?: Chat_Tm_Stop_PreviewingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tm_Stop_PreviewingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Preview, rewind, fork or restore from this message" |
*
*/
export const chat_tm_title: ((inputs?: Chat_Tm_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tm_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Today" |
*
*/
export const chat_today: ((inputs?: Chat_TodayInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_TodayInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The first {shown} of {total} characters." |
*
*/
export const chat_tool_first_characters: ((inputs: Chat_Tool_First_CharactersInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tool_First_CharactersInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{count} done" |
*
*/
export const chat_tool_group_done: ((inputs: Chat_Tool_Group_DoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tool_Group_DoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Hide these calls" |
*
*/
export const chat_tool_group_hide: ((inputs?: Chat_Tool_Group_HideInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tool_Group_HideInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} finished tool call: {names}" |
* | "other" | "{count} finished tool calls: {names}" |
*
*/
export const chat_tool_group_label: ((inputs: Chat_Tool_Group_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tool_Group_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show these calls" |
*
*/
export const chat_tool_group_show: ((inputs?: Chat_Tool_Group_ShowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tool_Group_ShowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} tool" |
* | "other" | "{count} tools" |
*
*/
export const chat_tool_group_tools: ((inputs: Chat_Tool_Group_ToolsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tool_Group_ToolsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Hide the output" |
*
*/
export const chat_tool_hide_output: ((inputs?: Chat_Tool_Hide_OutputInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tool_Hide_OutputInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} img" |
* | "other" | "{count} img" |
*
*/
export const chat_tool_images: ((inputs: Chat_Tool_ImagesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tool_ImagesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Loading the rest…" |
*
*/
export const chat_tool_loading_rest: ((inputs?: Chat_Tool_Loading_RestInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tool_Loading_RestInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show the output" |
*
*/
export const chat_tool_show_output: ((inputs?: Chat_Tool_Show_OutputInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Tool_Show_OutputInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "typing…" |
*
*/
export const chat_typing: ((inputs?: Chat_TypingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_TypingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} is waiting for you" |
*
*/
export const chat_waiting_for_you: ((inputs: Chat_Waiting_For_YouInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_Waiting_For_YouInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "working…" |
*
*/
export const chat_working: ((inputs?: Chat_WorkingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_WorkingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Yesterday" |
*
*/
export const chat_yesterday: ((inputs?: Chat_YesterdayInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Chat_YesterdayInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Anthropic API account (Console, usage billing)" |
*
*/
export const claudelogin_api: ((inputs?: Claudelogin_ApiInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_ApiInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign in with your Anthropic Console account; you pay for what you use." |
*
*/
export const claudelogin_api_sub: ((inputs?: Claudelogin_Api_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_Api_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cancel" |
*
*/
export const claudelogin_cancel: ((inputs?: Claudelogin_CancelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_CancelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Which account do you sign in with?" |
*
*/
export const claudelogin_choose: ((inputs?: Claudelogin_ChooseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_ChooseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close" |
*
*/
export const claudelogin_close: ((inputs?: Claudelogin_CloseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_CloseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Code" |
*
*/
export const claudelogin_code_label: ((inputs?: Claudelogin_Code_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_Code_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Paste the code" |
*
*/
export const claudelogin_code_placeholder: ((inputs?: Claudelogin_Code_PlaceholderInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_Code_PlaceholderInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Continue" |
*
*/
export const claudelogin_continue: ((inputs?: Claudelogin_ContinueInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_ContinueInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Copied" |
*
*/
export const claudelogin_copied: ((inputs?: Claudelogin_CopiedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_CopiedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Copy" |
*
*/
export const claudelogin_copy: ((inputs?: Claudelogin_CopyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_CopyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Done" |
*
*/
export const claudelogin_done: ((inputs?: Claudelogin_DoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_DoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Every Claude agent will use it; its models are read again." |
*
*/
export const claudelogin_done_body: ((inputs?: Claudelogin_Done_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_Done_BodyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign-in failed" |
*
*/
export const claudelogin_failed: ((inputs?: Claudelogin_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Finish" |
*
*/
export const claudelogin_finish: ((inputs?: Claudelogin_FinishInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_FinishInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Finishing…" |
*
*/
export const claudelogin_finishing: ((inputs?: Claudelogin_FinishingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_FinishingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign-in link" |
*
*/
export const claudelogin_link_label: ((inputs?: Claudelogin_Link_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_Link_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open the sign-in page, sign in, then paste the code it gives you here." |
*
*/
export const claudelogin_link_lead: ((inputs?: Claudelogin_Link_LeadInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_Link_LeadInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This Claude agent has no account to run on yet. Sign in to start it." |
*
*/
export const claudelogin_no_account: ((inputs?: Claudelogin_No_AccountInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_No_AccountInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{agent} has no account to run on yet. Sign in to start it." |
*
*/
export const claudelogin_no_account_named: ((inputs: Claudelogin_No_Account_NamedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_No_Account_NamedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open the sign-in page" |
*
*/
export const claudelogin_open: ((inputs?: Claudelogin_OpenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_OpenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Signed in" |
*
*/
export const claudelogin_signed_in: ((inputs?: Claudelogin_Signed_InInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_Signed_InInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Signed in as {email}" |
*
*/
export const claudelogin_signed_in_as: ((inputs: Claudelogin_Signed_In_AsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_Signed_In_AsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Starting Claude's sign-in…" |
*
*/
export const claudelogin_starting: ((inputs?: Claudelogin_StartingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_StartingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Claude subscription (Pro or Max)" |
*
*/
export const claudelogin_subscription: ((inputs?: Claudelogin_SubscriptionInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_SubscriptionInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign in with your claude.ai account." |
*
*/
export const claudelogin_subscription_sub: ((inputs?: Claudelogin_Subscription_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_Subscription_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign in to Claude" |
*
*/
export const claudelogin_title: ((inputs?: Claudelogin_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Try again" |
*
*/
export const claudelogin_try_again: ((inputs?: Claudelogin_Try_AgainInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Claudelogin_Try_AgainInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Attach a file" |
*
*/
export const composer_attach: ((inputs?: Composer_AttachInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_AttachInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Context {percent} full — the numbers behind it" |
*
*/
export const composer_context_dial: ((inputs: Composer_Context_DialInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Context_DialInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Context and cost" |
*
*/
export const composer_context_label: ((inputs?: Composer_Context_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Context_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This session" |
*
*/
export const composer_context_session: ((inputs?: Composer_Context_SessionInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Context_SessionInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Usage and limits" |
*
*/
export const composer_context_usage: ((inputs?: Composer_Context_UsageInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Context_UsageInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Used" |
*
*/
export const composer_context_used: ((inputs?: Composer_Context_UsedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Context_UsedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Window" |
*
*/
export const composer_context_window: ((inputs?: Composer_Context_WindowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Context_WindowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Message this agent" |
*
*/
export const composer_field_label: ((inputs?: Composer_Field_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Field_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{key} to choose" |
*
*/
export const composer_hint_choose: ((inputs: Composer_Hint_ChooseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Hint_ChooseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{key} for commands" |
*
*/
export const composer_hint_commands: ((inputs: Composer_Hint_CommandsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Hint_CommandsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{key} to complete" |
*
*/
export const composer_hint_complete: ((inputs: Composer_Hint_CompleteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Hint_CompleteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{key} to dismiss" |
*
*/
export const composer_hint_dismiss: ((inputs: Composer_Hint_DismissInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Hint_DismissInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{key} for an agent" |
*
*/
export const composer_hint_mention: ((inputs: Composer_Hint_MentionInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Hint_MentionInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{key} for a new line" |
*
*/
export const composer_hint_newline: ((inputs: Composer_Hint_NewlineInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Hint_NewlineInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{key} to queue" |
*
*/
export const composer_hint_queue: ((inputs: Composer_Hint_QueueInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Hint_QueueInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{key} to send" |
*
*/
export const composer_hint_send: ((inputs: Composer_Hint_SendInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Hint_SendInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{key} to steer" |
*
*/
export const composer_hint_steer: ((inputs: Composer_Hint_SteerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Hint_SteerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Listening…" |
*
*/
export const composer_listening: ((inputs?: Composer_ListeningInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_ListeningInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Who to name" |
*
*/
export const composer_mention_label: ((inputs?: Composer_Mention_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mention_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The microphone could not start: another app may be holding it." |
*
*/
export const composer_mic_busy: ((inputs?: Composer_Mic_BusyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mic_BusyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The microphone could not start." |
*
*/
export const composer_mic_failed: ((inputs?: Composer_Mic_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mic_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The microphone could not start ({name})." |
*
*/
export const composer_mic_failed_named: ((inputs: Composer_Mic_Failed_NamedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mic_Failed_NamedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The browser gives the microphone only to an HTTPS address or localhost." |
*
*/
export const composer_mic_https: ((inputs?: Composer_Mic_HttpsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mic_HttpsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This browser has no microphone to give." |
*
*/
export const composer_mic_no_browser_mic: ((inputs?: Composer_Mic_No_Browser_MicInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mic_No_Browser_MicInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No microphone here." |
*
*/
export const composer_mic_none_here: ((inputs?: Composer_Mic_None_HereInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mic_None_HereInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No microphone is connected to this computer." |
*
*/
export const composer_mic_not_connected: ((inputs?: Composer_Mic_Not_ConnectedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mic_Not_ConnectedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This site's microphone permission is off: the browser's site settings can change that." |
*
*/
export const composer_mic_site_off: ((inputs?: Composer_Mic_Site_OffInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mic_Site_OffInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Speak" |
*
*/
export const composer_mic_speak: ((inputs?: Composer_Mic_SpeakInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mic_SpeakInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The computer is keeping the microphone from this browser: on a Mac, System Settings › Privacy & Security › Microphone." |
*
*/
export const composer_mic_system: ((inputs?: Composer_Mic_SystemInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mic_SystemInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Speak instead of typing (Ctrl+M)" |
*
*/
export const composer_mic_title: ((inputs?: Composer_Mic_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mic_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Turning it into words…" |
*
*/
export const composer_mic_transcribing: ((inputs?: Composer_Mic_TranscribingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mic_TranscribingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Ask first" |
*
*/
export const composer_mode_ask: ((inputs?: Composer_Mode_AskInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mode_AskInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Ask before anything it judges worth asking about." |
*
*/
export const composer_mode_ask_note: ((inputs?: Composer_Mode_Ask_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mode_Ask_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Auto" |
*
*/
export const composer_mode_auto: ((inputs?: Composer_Mode_AutoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mode_AutoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Stop asking altogether and decide for itself." |
*
*/
export const composer_mode_auto_note: ((inputs?: Composer_Mode_Auto_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mode_Auto_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Edit freely" |
*
*/
export const composer_mode_edit: ((inputs?: Composer_Mode_EditInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mode_EditInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Stop asking about board edits. Commands still ask." |
*
*/
export const composer_mode_edit_note: ((inputs?: Composer_Mode_Edit_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mode_Edit_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "How much this agent asks before acting" |
*
*/
export const composer_mode_label: ((inputs?: Composer_Mode_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mode_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Plan only" |
*
*/
export const composer_mode_plan: ((inputs?: Composer_Mode_PlanInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mode_PlanInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Change nothing at all: read, think, and propose a plan to approve." |
*
*/
export const composer_mode_plan_note: ((inputs?: Composer_Mode_Plan_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Mode_Plan_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Account" |
*
*/
export const composer_model_account: ((inputs?: Composer_Model_AccountInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Model_AccountInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "default model" |
*
*/
export const composer_model_default: ((inputs?: Composer_Model_DefaultInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Model_DefaultInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Find a model" |
*
*/
export const composer_model_find: ((inputs?: Composer_Model_FindInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Model_FindInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Model and thinking level" |
*
*/
export const composer_model_label: ((inputs?: Composer_Model_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Model_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This account has no credentials behind it. Add it again in settings" |
*
*/
export const composer_model_no_credentials: ((inputs?: Composer_Model_No_CredentialsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Model_No_CredentialsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No model matches that" |
*
*/
export const composer_model_none: ((inputs?: Composer_Model_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Model_NoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Search models" |
*
*/
export const composer_model_search: ((inputs?: Composer_Model_SearchInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Model_SearchInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "signed out" |
*
*/
export const composer_model_signed_out: ((inputs?: Composer_Model_Signed_OutInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Model_Signed_OutInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Thinking" |
*
*/
export const composer_model_thinking: ((inputs?: Composer_Model_ThinkingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Model_ThinkingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "From the canvas" |
*
*/
export const composer_pill_canvas: ((inputs?: Composer_Pill_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Pill_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "From the canvas, #{component}" |
*
*/
export const composer_pill_canvas_in: ((inputs: Composer_Pill_Canvas_InInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Pill_Canvas_InInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "From the canvas, on {name}" |
*
*/
export const composer_pill_canvas_on: ((inputs: Composer_Pill_Canvas_OnInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Pill_Canvas_OnInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "On the canvas, a board or card: {path}" |
*
*/
export const composer_pill_card: ((inputs: Composer_Pill_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Pill_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "File, in the deck as {path}" |
*
*/
export const composer_pill_file: ((inputs: Composer_Pill_FileInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Pill_FileInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "On the canvas, a drawn item" |
*
*/
export const composer_pill_item: ((inputs?: Composer_Pill_ItemInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Pill_ItemInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Your comment" |
*
*/
export const composer_pill_yours: ((inputs?: Composer_Pill_YoursInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Pill_YoursInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Your comment, #{component}" |
*
*/
export const composer_pill_yours_in: ((inputs: Composer_Pill_Yours_InInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Pill_Yours_InInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Your comment, on {name}" |
*
*/
export const composer_pill_yours_on: ((inputs: Composer_Pill_Yours_OnInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Pill_Yours_OnInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Ask {name} to draw, plan or build…" |
*
*/
export const composer_placeholder_ask: ((inputs: Composer_Placeholder_AskInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Placeholder_AskInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Steer {name}'s turn…" |
*
*/
export const composer_placeholder_steer: ((inputs: Composer_Placeholder_SteerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Placeholder_SteerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Edit" |
*
*/
export const composer_queue_edit: ((inputs?: Composer_Queue_EditInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Queue_EditInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Put it back in the box" |
*
*/
export const composer_queue_edit_title: ((inputs?: Composer_Queue_Edit_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Queue_Edit_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fold the queue" |
*
*/
export const composer_queue_fold: ((inputs?: Composer_Queue_FoldInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Queue_FoldInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "held by Stop" |
*
*/
export const composer_queue_held: ((inputs?: Composer_Queue_HeldInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Queue_HeldInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Queued messages" |
*
*/
export const composer_queue_label: ((inputs?: Composer_Queue_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Queue_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "next: {text}" |
*
*/
export const composer_queue_next: ((inputs: Composer_Queue_NextInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Queue_NextInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "sent one per turn" |
*
*/
export const composer_queue_one_per_turn: ((inputs?: Composer_Queue_One_Per_TurnInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Queue_One_Per_TurnInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Send every queued line now, as steers" |
*
*/
export const composer_queue_release_all: ((inputs?: Composer_Queue_Release_AllInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Queue_Release_AllInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Send the held queue" |
*
*/
export const composer_queue_release_held: ((inputs?: Composer_Queue_Release_HeldInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Queue_Release_HeldInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Remove" |
*
*/
export const composer_queue_remove: ((inputs?: Composer_Queue_RemoveInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Queue_RemoveInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Send all now" |
*
*/
export const composer_queue_send_all: ((inputs?: Composer_Queue_Send_AllInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Queue_Send_AllInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Send now" |
*
*/
export const composer_queue_send_now: ((inputs?: Composer_Queue_Send_NowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Queue_Send_NowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Send now, as a steer" |
*
*/
export const composer_queue_send_now_title: ((inputs?: Composer_Queue_Send_Now_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Queue_Send_Now_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show the queue" |
*
*/
export const composer_queue_show: ((inputs?: Composer_Queue_ShowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Queue_ShowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} queued for {name}" |
* | "other" | "{count} queued for {name}" |
*
*/
export const composer_queue_title: ((inputs: Composer_Queue_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Queue_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "a board" |
*
*/
export const composer_recipient_board: ((inputs?: Composer_Recipient_BoardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Recipient_BoardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Who gets the line: {label}. Press to choose." |
*
*/
export const composer_recipient_chip: ((inputs: Composer_Recipient_ChipInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Recipient_ChipInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Who gets the line" |
*
*/
export const composer_recipient_label: ((inputs?: Composer_Recipient_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Recipient_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No agent" |
*
*/
export const composer_recipient_none: ((inputs?: Composer_Recipient_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Recipient_NoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "To" |
*
*/
export const composer_recipient_to: ((inputs?: Composer_Recipient_ToInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Recipient_ToInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Recording" |
*
*/
export const composer_recording: ((inputs?: Composer_RecordingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_RecordingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Discard recording" |
*
*/
export const composer_recording_discard: ((inputs?: Composer_Recording_DiscardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Recording_DiscardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Throw this take away (Esc)" |
*
*/
export const composer_recording_discard_title: ((inputs?: Composer_Recording_Discard_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Recording_Discard_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Done recording" |
*
*/
export const composer_recording_done: ((inputs?: Composer_Recording_DoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Recording_DoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Keep the words: they go in the box (Ctrl+M)" |
*
*/
export const composer_recording_done_title: ((inputs?: Composer_Recording_Done_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Recording_Done_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Send" |
*
*/
export const composer_send: ((inputs?: Composer_SendInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_SendInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "ext" |
*
*/
export const composer_slash_ext: ((inputs?: Composer_Slash_ExtInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Slash_ExtInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Commands" |
*
*/
export const composer_slash_label: ((inputs?: Composer_Slash_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Slash_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "prompt" |
*
*/
export const composer_slash_prompt: ((inputs?: Composer_Slash_PromptInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Slash_PromptInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "skill" |
*
*/
export const composer_slash_skill: ((inputs?: Composer_Slash_SkillInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Slash_SkillInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Steer this turn" |
*
*/
export const composer_steer: ((inputs?: Composer_SteerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_SteerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Stop this turn" |
*
*/
export const composer_stop: ((inputs?: Composer_StopInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_StopInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The browser's recogniser stopped: {reason}." |
*
*/
export const composer_stt_browser_stopped: ((inputs: Composer_Stt_Browser_StoppedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Stt_Browser_StoppedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This browser has no speech recogniser: pick the server's in Settings." |
*
*/
export const composer_stt_no_browser: ((inputs?: Composer_Stt_No_BrowserInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Stt_No_BrowserInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This server has no speech recogniser, and nor has this browser: set OPENAI_API_KEY on the server." |
*
*/
export const composer_stt_no_either: ((inputs?: Composer_Stt_No_EitherInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Stt_No_EitherInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This server has no speech recogniser: set OPENAI_API_KEY in its environment, or pick the browser's in Settings." |
*
*/
export const composer_stt_no_server: ((inputs?: Composer_Stt_No_ServerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Stt_No_ServerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The server could not transcribe it ({status})." |
*
*/
export const composer_stt_server_failed: ((inputs: Composer_Stt_Server_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Stt_Server_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the agent" |
*
*/
export const composer_the_agent: ((inputs?: Composer_The_AgentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_The_AgentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "high" |
*
*/
export const composer_thinking_high: ((inputs?: Composer_Thinking_HighInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Thinking_HighInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "low" |
*
*/
export const composer_thinking_low: ((inputs?: Composer_Thinking_LowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Thinking_LowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "max" |
*
*/
export const composer_thinking_max: ((inputs?: Composer_Thinking_MaxInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Thinking_MaxInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "medium" |
*
*/
export const composer_thinking_medium: ((inputs?: Composer_Thinking_MediumInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Thinking_MediumInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "minimal" |
*
*/
export const composer_thinking_minimal: ((inputs?: Composer_Thinking_MinimalInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Thinking_MinimalInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "off" |
*
*/
export const composer_thinking_off: ((inputs?: Composer_Thinking_OffInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Thinking_OffInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "xhigh" |
*
*/
export const composer_thinking_xhigh: ((inputs?: Composer_Thinking_XhighInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Thinking_XhighInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Automatic" |
*
*/
export const composer_voice_auto: ((inputs?: Composer_Voice_AutoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Voice_AutoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The server's if it has a key, else this browser's." |
*
*/
export const composer_voice_auto_note: ((inputs?: Composer_Voice_Auto_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Voice_Auto_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Browser" |
*
*/
export const composer_voice_browser: ((inputs?: Composer_Voice_BrowserInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Voice_BrowserInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Free and live, one language at a time." |
*
*/
export const composer_voice_browser_note: ((inputs?: Composer_Voice_Browser_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Voice_Browser_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This browser's language" |
*
*/
export const composer_voice_lang_browser: ((inputs?: Composer_Voice_Lang_BrowserInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Voice_Lang_BrowserInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Server" |
*
*/
export const composer_voice_server: ((inputs?: Composer_Voice_ServerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Voice_ServerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "OpenAI, through this server: any language." |
*
*/
export const composer_voice_server_note: ((inputs?: Composer_Voice_Server_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Composer_Voice_Server_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Server address" |
*
*/
export const connections_address: ((inputs?: Connections_AddressInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_AddressInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Back" |
*
*/
export const connections_back: ((inputs?: Connections_BackInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_BackInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pairing code" |
*
*/
export const connections_code: ((inputs?: Connections_CodeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_CodeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "only over the internet" |
*
*/
export const connections_code_hint: ((inputs?: Connections_Code_HintInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Code_HintInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "From decks pair code on that machine" |
*
*/
export const connections_code_placeholder: ((inputs?: Connections_Code_PlaceholderInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Code_PlaceholderInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Connect" |
*
*/
export const connections_connect: ((inputs?: Connections_ConnectInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_ConnectInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Connect a server…" |
*
*/
export const connections_connect_server: ((inputs?: Connections_Connect_ServerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Connect_ServerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Connecting…" |
*
*/
export const connections_connecting: ((inputs?: Connections_ConnectingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_ConnectingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Download this canvas" |
*
*/
export const connections_download: ((inputs?: Connections_DownloadInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_DownloadInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "file · {count} card" |
* | "other" | "file · {count} cards" |
*
*/
export const connections_file_cards: ((inputs: Connections_File_CardsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_File_CardsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Opening a canvas file needs this page on HTTPS or localhost." |
*
*/
export const connections_file_needs_https: ((inputs?: Connections_File_Needs_HttpsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_File_Needs_HttpsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This canvas's files are gone from this browser. Open the .decks file again." |
*
*/
export const connections_files_gone: ((inputs?: Connections_Files_GoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Files_GoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Forget {name}" |
*
*/
export const connections_forget_label: ((inputs: Connections_Forget_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Forget_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Forget this server" |
*
*/
export const connections_forget_server: ((inputs?: Connections_Forget_ServerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Forget_ServerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Connections" |
*
*/
export const connections_label: ((inputs?: Connections_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Name" |
*
*/
export const connections_name: ((inputs?: Connections_NameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_NameInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "What the server calls itself" |
*
*/
export const connections_name_placeholder: ((inputs?: Connections_Name_PlaceholderInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Name_PlaceholderInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This canvas was saved by a newer Decks (format {format})." |
*
*/
export const connections_newer_format: ((inputs: Connections_Newer_FormatInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Newer_FormatInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This file has no manifest, so it is not a Decks canvas." |
*
*/
export const connections_no_manifest: ((inputs?: Connections_No_ManifestInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_No_ManifestInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This server would not relay that one ({status})." |
*
*/
export const connections_no_relay: ((inputs: Connections_No_RelayInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_No_RelayInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "That is not an address." |
*
*/
export const connections_not_address: ((inputs?: Connections_Not_AddressInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Not_AddressInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "not reachable" |
*
*/
export const connections_not_reachable: ((inputs?: Connections_Not_ReachableInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Not_ReachableInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This file is not a .decks bundle: it is not a zip." |
*
*/
export const connections_not_zip: ((inputs?: Connections_Not_ZipInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Not_ZipInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open a canvas file…" |
*
*/
export const connections_open_file: ((inputs?: Connections_Open_FileInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Open_FileInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "optional" |
*
*/
export const connections_optional: ((inputs?: Connections_OptionalInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_OptionalInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Other decks" |
*
*/
export const connections_other_decks: ((inputs?: Connections_Other_DecksInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Other_DecksInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "pairing revoked" |
*
*/
export const connections_pairing_revoked: ((inputs?: Connections_Pairing_RevokedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Pairing_RevokedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "read only" |
*
*/
export const connections_read_only: ((inputs?: Connections_Read_OnlyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Read_OnlyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This canvas is a file opened in this browser: it cannot be changed from here." |
*
*/
export const connections_read_only_refusal: ((inputs?: Connections_Read_Only_RefusalInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Read_Only_RefusalInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Remove this canvas from this browser" |
*
*/
export const connections_remove_bundle: ((inputs?: Connections_Remove_BundleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Remove_BundleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Rename" |
*
*/
export const connections_rename: ((inputs?: Connections_RenameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_RenameInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Rename {name}" |
*
*/
export const connections_rename_label: ((inputs: Connections_Rename_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Rename_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The server answered {status}." |
*
*/
export const connections_server_answered: ((inputs: Connections_Server_AnsweredInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Server_AnsweredInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This address names a connection this browser does not have any more." |
*
*/
export const connections_start_forgotten: ((inputs?: Connections_Start_ForgottenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Start_ForgottenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open a canvas file someone sent you, or connect to a Decks server you can reach." |
*
*/
export const connections_start_public: ((inputs?: Connections_Start_PublicInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Start_PublicInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open a file or connect a server" |
*
*/
export const connections_start_switcher: ((inputs?: Connections_Start_SwitcherInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Start_SwitcherInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Switch between servers and canvas files" |
*
*/
export const connections_switch_title: ((inputs?: Connections_Switch_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Switch_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This server" |
*
*/
export const connections_this_server: ((inputs?: Connections_This_ServerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_This_ServerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Could not reach {base}. It must be a Decks server on HTTPS (or localhost) that this browser can reach." |
*
*/
export const connections_unreachable: ((inputs: Connections_UnreachableInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_UnreachableInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Opening another server or a canvas file needs this page on HTTPS or localhost; on a plain http:// address the browser has no service workers." |
*
*/
export const connections_worker_needs_https: ((inputs?: Connections_Worker_Needs_HttpsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Worker_Needs_HttpsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This bundle's table of contents is damaged." |
*
*/
export const connections_zip_damaged: ((inputs?: Connections_Zip_DamagedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Connections_Zip_DamagedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Accept" |
*
*/
export const docs_accept: ((inputs?: Docs_AcceptInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_AcceptInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Accept all" |
*
*/
export const docs_accept_all: ((inputs?: Docs_Accept_AllInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Accept_AllInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Keep every edit" |
*
*/
export const docs_accept_all_title: ((inputs?: Docs_Accept_All_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Accept_All_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Another program" |
*
*/
export const docs_another_program: ((inputs?: Docs_Another_ProgramInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Another_ProgramInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Back to now" |
*
*/
export const docs_back_to_now: ((inputs?: Docs_Back_To_NowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Back_To_NowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cancel" |
*
*/
export const docs_cancel: ((inputs?: Docs_CancelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_CancelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Changes" |
*
*/
export const docs_changes: ((inputs?: Docs_ChangesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_ChangesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Edits from agents, to accept or reject" |
*
*/
export const docs_changes_title: ((inputs?: Docs_Changes_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Changes_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close" |
*
*/
export const docs_close: ((inputs?: Docs_CloseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_CloseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close the PDF" |
*
*/
export const docs_close_pdf: ((inputs?: Docs_Close_PdfInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Close_PdfInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Comment" |
*
*/
export const docs_comment: ((inputs?: Docs_CommentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_CommentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Comments" |
*
*/
export const docs_comments: ((inputs?: Docs_CommentsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_CommentsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The Doc's comments" |
*
*/
export const docs_comments_title: ((inputs?: Docs_Comments_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Comments_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Done" |
*
*/
export const docs_done: ((inputs?: Docs_DoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_DoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Drag to resize" |
*
*/
export const docs_drag_resize: ((inputs?: Docs_Drag_ResizeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Drag_ResizeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Earlier version" |
*
*/
export const docs_earlier_version: ((inputs?: Docs_Earlier_VersionInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Earlier_VersionInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Edited" |
*
*/
export const docs_edited: ((inputs?: Docs_EditedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_EditedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Edited by {who} at {time}" |
*
*/
export const docs_edited_by: ((inputs: Docs_Edited_ByInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Edited_ByInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Edited by another program at {time}" |
*
*/
export const docs_edited_outside: ((inputs: Docs_Edited_OutsideInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Edited_OutsideInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This document is empty." |
*
*/
export const docs_empty: ((inputs?: Docs_EmptyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_EmptyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Empty. Click to write." |
*
*/
export const docs_empty_click: ((inputs?: Docs_Empty_ClickInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Empty_ClickInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} error" |
* | "other" | "{count} errors" |
*
*/
export const docs_errors: ((inputs: Docs_ErrorsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_ErrorsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Typesetting the paper for the first time can take a minute while LaTeX fetches its packages." |
*
*/
export const docs_first_typeset: ((inputs?: Docs_First_TypesetInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_First_TypesetInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} commit to push" |
* | "other" | "{count} commits to push" |
*
*/
export const docs_git_ahead: ((inputs: Docs_Git_AheadInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_AheadInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{count} to pull" |
*
*/
export const docs_git_behind: ((inputs: Docs_Git_BehindInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_BehindInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{branch}: pull and push" |
*
*/
export const docs_git_button_title: ((inputs: Docs_Git_Button_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_Button_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} file edited since the last commit" |
* | "other" | "{count} files edited since the last commit" |
*
*/
export const docs_git_changed: ((inputs: Docs_Git_ChangedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_ChangedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Done." |
*
*/
export const docs_git_done: ((inputs?: Docs_Git_DoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_DoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "In step with {name} as of the last pull." |
*
*/
export const docs_git_in_step: ((inputs: Docs_Git_In_StepInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_In_StepInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This branch has no remote branch to pull from or push to." |
*
*/
export const docs_git_no_remote: ((inputs?: Docs_Git_No_RemoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_No_RemoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Commits not pushed yet" |
*
*/
export const docs_git_not_pushed: ((inputs?: Docs_Git_Not_PushedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_Not_PushedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Edits here are committed as \"Edited in Decks\" before each pull. What a pull brings in is highlighted as a change." |
*
*/
export const docs_git_note: ((inputs?: Docs_Git_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pull" |
*
*/
export const docs_git_pull: ((inputs?: Docs_Git_PullInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_PullInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Commit what is edited here, and merge in what changed on {name}" |
*
*/
export const docs_git_pull_title: ((inputs: Docs_Git_Pull_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_Pull_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pulling…" |
*
*/
export const docs_git_pulling: ((inputs?: Docs_Git_PullingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_PullingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Push" |
*
*/
export const docs_git_push: ((inputs?: Docs_Git_PushInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_PushInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pull, then send the commits made here to {name}" |
*
*/
export const docs_git_push_title: ((inputs: Docs_Git_Push_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_Push_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pushing…" |
*
*/
export const docs_git_pushing: ((inputs?: Docs_Git_PushingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_PushingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{parts}." |
*
*/
export const docs_git_state: ((inputs: Docs_Git_StateInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_StateInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "git stopped." |
*
*/
export const docs_git_stopped: ((inputs?: Docs_Git_StoppedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_StoppedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pull and push this file's git repository" |
*
*/
export const docs_git_title: ((inputs?: Docs_Git_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Git_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Go to this line" |
*
*/
export const docs_go_to_line: ((inputs?: Docs_Go_To_LineInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Go_To_LineInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{title}, a Google Doc" |
*
*/
export const docs_google_doc_named: ((inputs: Docs_Google_Doc_NamedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_Doc_NamedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Not in step" |
*
*/
export const docs_google_error: ((inputs?: Docs_Google_ErrorInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_ErrorInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "That did not work." |
*
*/
export const docs_google_failed: ((inputs?: Docs_Google_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "A stand-in for Google on this server: no Google account is connected." |
*
*/
export const docs_google_fake: ((inputs?: Docs_Google_FakeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_FakeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "In step with the Doc. Edits here reach Google in about two seconds; others' edits arrive highlighted." |
*
*/
export const docs_google_in_step: ((inputs?: Docs_Google_In_StepInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_In_StepInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "In step with the Doc since {time}. Edits here reach Google in about two seconds; others' edits arrive highlighted." |
*
*/
export const docs_google_in_step_since: ((inputs: Docs_Google_In_Step_SinceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_In_Step_SinceInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open in Google Docs" |
*
*/
export const docs_google_open: ((inputs?: Docs_Google_OpenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_OpenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Paste the address Google sent you to" |
*
*/
export const docs_google_paste: ((inputs?: Docs_Google_PasteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_PasteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Address after signing in" |
*
*/
export const docs_google_paste_label: ((inputs?: Docs_Google_Paste_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_Paste_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sending your edits to Google…" |
*
*/
export const docs_google_sending: ((inputs?: Docs_Google_SendingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_SendingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign in with Google" |
*
*/
export const docs_google_sign_in: ((inputs?: Docs_Google_Sign_InInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_Sign_InInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Signed in as {email}." |
*
*/
export const docs_google_signed_in: ((inputs: Docs_Google_Signed_InInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_Signed_InInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Signed in to Google as {email}." |
*
*/
export const docs_google_signed_in_as: ((inputs: Docs_Google_Signed_In_AsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_Signed_In_AsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign in" |
*
*/
export const docs_google_signin: ((inputs?: Docs_Google_SigninInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_SigninInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Syncing…" |
*
*/
export const docs_google_syncing: ((inputs?: Docs_Google_SyncingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_SyncingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This page is a Google Doc" |
*
*/
export const docs_google_title: ((inputs?: Docs_Google_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Google_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "History" |
*
*/
export const docs_history: ((inputs?: Docs_HistoryInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_HistoryInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Earlier versions of this file" |
*
*/
export const docs_history_title: ((inputs?: Docs_History_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_History_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{command} is not a command KaTeX knows" |
*
*/
export const docs_katex_unknown: ((inputs: Docs_Katex_UnknownInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Katex_UnknownInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "LaTeX stopped before writing a page. The errors above say where." |
*
*/
export const docs_latex_stopped: ((inputs?: Docs_Latex_StoppedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Latex_StoppedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Line {line}" |
*
*/
export const docs_line: ((inputs: Docs_LineInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_LineInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Link to" |
*
*/
export const docs_link_prompt: ((inputs?: Docs_Link_PromptInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Link_PromptInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Front matter" |
*
*/
export const docs_md_front_matter: ((inputs?: Docs_Md_Front_MatterInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Md_Front_MatterInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No open comments. Select words and press the comment button to add one." |
*
*/
export const docs_no_comments: ((inputs?: Docs_No_CommentsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_No_CommentsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No versions yet." |
*
*/
export const docs_no_versions: ((inputs?: Docs_No_VersionsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_No_VersionsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Not drawn" |
*
*/
export const docs_not_drawn: ((inputs?: Docs_Not_DrawnInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Not_DrawnInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Not drawn: {reason}" |
*
*/
export const docs_not_drawn_because: ((inputs: Docs_Not_Drawn_BecauseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Not_Drawn_BecauseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Did not typeset" |
*
*/
export const docs_not_typeset: ((inputs?: Docs_Not_TypesetInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Not_TypesetInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Nothing to review." |
*
*/
export const docs_nothing_to_review: ((inputs?: Docs_Nothing_To_ReviewInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Nothing_To_ReviewInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open the PDF in a new tab" |
*
*/
export const docs_open_pdf: ((inputs?: Docs_Open_PdfInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Open_PdfInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Opening…" |
*
*/
export const docs_opening: ((inputs?: Docs_OpeningInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_OpeningInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Paragraph style" |
*
*/
export const docs_paragraph_style: ((inputs?: Docs_Paragraph_StyleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Paragraph_StyleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Not typeset yet" |
*
*/
export const docs_pdf_not_yet: ((inputs?: Docs_Pdf_Not_YetInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Pdf_Not_YetInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Typeset this file and show the PDF beside it" |
*
*/
export const docs_pdf_title: ((inputs?: Docs_Pdf_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Pdf_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The PDF was made but could not be read." |
*
*/
export const docs_pdf_unreadable: ((inputs?: Docs_Pdf_UnreadableInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Pdf_UnreadableInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Read-only" |
*
*/
export const docs_read_only: ((inputs?: Docs_Read_OnlyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Read_OnlyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Reading…" |
*
*/
export const docs_reading: ((inputs?: Docs_ReadingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_ReadingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Reject" |
*
*/
export const docs_reject: ((inputs?: Docs_RejectInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_RejectInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Reject all" |
*
*/
export const docs_reject_all: ((inputs?: Docs_Reject_AllInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Reject_AllInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Take every edit back" |
*
*/
export const docs_reject_all_title: ((inputs?: Docs_Reject_All_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Reject_All_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Reply" |
*
*/
export const docs_reply: ((inputs?: Docs_ReplyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_ReplyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Resolve" |
*
*/
export const docs_resolve: ((inputs?: Docs_ResolveInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_ResolveInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Restore" |
*
*/
export const docs_restore: ((inputs?: Docs_RestoreInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_RestoreInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Restore this version" |
*
*/
export const docs_restore_version: ((inputs?: Docs_Restore_VersionInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Restore_VersionInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Saved" |
*
*/
export const docs_saved: ((inputs?: Docs_SavedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_SavedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Saving…" |
*
*/
export const docs_saving: ((inputs?: Docs_SavingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_SavingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show this version" |
*
*/
export const docs_show_version: ((inputs?: Docs_Show_VersionInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Show_VersionInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Someone" |
*
*/
export const docs_someone: ((inputs?: Docs_SomeoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_SomeoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Source" |
*
*/
export const docs_source: ((inputs?: Docs_SourceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_SourceInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show the file as its source" |
*
*/
export const docs_source_title: ((inputs?: Docs_Source_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Source_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Start writing…" |
*
*/
export const docs_start_writing: ((inputs?: Docs_Start_WritingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Start_WritingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Body" |
*
*/
export const docs_style_body: ((inputs?: Docs_Style_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Style_BodyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Body text" |
*
*/
export const docs_style_body_text: ((inputs?: Docs_Style_Body_TextInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Style_Body_TextInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Heading {level}" |
*
*/
export const docs_style_heading: ((inputs: Docs_Style_HeadingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Style_HeadingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Normal text" |
*
*/
export const docs_style_normal: ((inputs?: Docs_Style_NormalInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Style_NormalInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Paragraph heading" |
*
*/
export const docs_style_paragraph_heading: ((inputs?: Docs_Style_Paragraph_HeadingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Style_Paragraph_HeadingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Section" |
*
*/
export const docs_style_section: ((inputs?: Docs_Style_SectionInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Style_SectionInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Subsection" |
*
*/
export const docs_style_subsection: ((inputs?: Docs_Style_SubsectionInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Style_SubsectionInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Subsubsection" |
*
*/
export const docs_style_subsubsection: ((inputs?: Docs_Style_SubsubsectionInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Style_SubsubsectionInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Subtitle" |
*
*/
export const docs_style_subtitle: ((inputs?: Docs_Style_SubtitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Style_SubtitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Title" |
*
*/
export const docs_style_title: ((inputs?: Docs_Style_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Style_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No \\title in the preamble" |
*
*/
export const docs_tex_no_title: ((inputs?: Docs_Tex_No_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tex_No_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "Preamble, {count} line" |
* | "other" | "Preamble, {count} lines" |
*
*/
export const docs_tex_preamble: ((inputs: Docs_Tex_PreambleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tex_PreambleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Centre align" |
*
*/
export const docs_tool_align_centre: ((inputs?: Docs_Tool_Align_CentreInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_Align_CentreInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Left align" |
*
*/
export const docs_tool_align_left: ((inputs?: Docs_Tool_Align_LeftInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_Align_LeftInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Right align" |
*
*/
export const docs_tool_align_right: ((inputs?: Docs_Tool_Align_RightInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_Align_RightInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Increase font size" |
*
*/
export const docs_tool_bigger: ((inputs?: Docs_Tool_BiggerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_BiggerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Bold ({key})" |
*
*/
export const docs_tool_bold: ((inputs: Docs_Tool_BoldInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_BoldInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Bulleted list ({key})" |
*
*/
export const docs_tool_bullets: ((inputs: Docs_Tool_BulletsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_BulletsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Clear formatting ({key})" |
*
*/
export const docs_tool_clear: ((inputs: Docs_Tool_ClearInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_ClearInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Code ({key})" |
*
*/
export const docs_tool_code: ((inputs: Docs_Tool_CodeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_CodeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Code block" |
*
*/
export const docs_tool_codeblock: ((inputs?: Docs_Tool_CodeblockInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_CodeblockInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Insert column left" |
*
*/
export const docs_tool_col_left: ((inputs?: Docs_Tool_Col_LeftInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_Col_LeftInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Insert column right" |
*
*/
export const docs_tool_col_right: ((inputs?: Docs_Tool_Col_RightInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_Col_RightInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Comment on the selected words" |
*
*/
export const docs_tool_comment: ((inputs?: Docs_Tool_CommentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_CommentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delete column" |
*
*/
export const docs_tool_delete_col: ((inputs?: Docs_Tool_Delete_ColInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_Delete_ColInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delete row" |
*
*/
export const docs_tool_delete_row: ((inputs?: Docs_Tool_Delete_RowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_Delete_RowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Equation" |
*
*/
export const docs_tool_equation: ((inputs?: Docs_Tool_EquationInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_EquationInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Font" |
*
*/
export const docs_tool_font: ((inputs?: Docs_Tool_FontInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_FontInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Font size" |
*
*/
export const docs_tool_font_size: ((inputs?: Docs_Tool_Font_SizeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_Font_SizeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Highlight ({key})" |
*
*/
export const docs_tool_highlight: ((inputs: Docs_Tool_HighlightInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_HighlightInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Highlight colour" |
*
*/
export const docs_tool_highlight_colour: ((inputs?: Docs_Tool_Highlight_ColourInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_Highlight_ColourInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Increase indent ({key})" |
*
*/
export const docs_tool_indent: ((inputs: Docs_Tool_IndentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_IndentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Insert a table (3 by 3)" |
*
*/
export const docs_tool_insert_table: ((inputs?: Docs_Tool_Insert_TableInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_Insert_TableInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Italic ({key})" |
*
*/
export const docs_tool_italic: ((inputs: Docs_Tool_ItalicInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_ItalicInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Justify" |
*
*/
export const docs_tool_justify: ((inputs?: Docs_Tool_JustifyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_JustifyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Link ({key})" |
*
*/
export const docs_tool_link: ((inputs: Docs_Tool_LinkInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_LinkInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Inline maths ({key})" |
*
*/
export const docs_tool_math: ((inputs: Docs_Tool_MathInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_MathInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Numbered list" |
*
*/
export const docs_tool_numbered: ((inputs?: Docs_Tool_NumberedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_NumberedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Numbered list ({key})" |
*
*/
export const docs_tool_numbers: ((inputs: Docs_Tool_NumbersInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_NumbersInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Decrease indent ({key})" |
*
*/
export const docs_tool_outdent: ((inputs: Docs_Tool_OutdentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_OutdentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Quote" |
*
*/
export const docs_tool_quote: ((inputs?: Docs_Tool_QuoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_QuoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Redo ({key})" |
*
*/
export const docs_tool_redo: ((inputs: Docs_Tool_RedoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_RedoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Insert row above" |
*
*/
export const docs_tool_row_above: ((inputs?: Docs_Tool_Row_AboveInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_Row_AboveInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Insert row below" |
*
*/
export const docs_tool_row_below: ((inputs?: Docs_Tool_Row_BelowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_Row_BelowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Horizontal rule" |
*
*/
export const docs_tool_rule: ((inputs?: Docs_Tool_RuleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_RuleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Decrease font size" |
*
*/
export const docs_tool_smaller: ((inputs?: Docs_Tool_SmallerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_SmallerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Strikethrough ({key})" |
*
*/
export const docs_tool_strike: ((inputs: Docs_Tool_StrikeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_StrikeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Table" |
*
*/
export const docs_tool_table: ((inputs?: Docs_Tool_TableInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_TableInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Task list" |
*
*/
export const docs_tool_tasks: ((inputs?: Docs_Tool_TasksInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_TasksInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Text colour" |
*
*/
export const docs_tool_text_colour: ((inputs?: Docs_Tool_Text_ColourInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_Text_ColourInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Underline ({key})" |
*
*/
export const docs_tool_underline: ((inputs: Docs_Tool_UnderlineInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_UnderlineInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Undo ({key})" |
*
*/
export const docs_tool_undo: ((inputs: Docs_Tool_UndoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Tool_UndoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Typeset" |
*
*/
export const docs_typeset: ((inputs?: Docs_TypesetInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_TypesetInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Typeset again" |
*
*/
export const docs_typeset_again: ((inputs?: Docs_Typeset_AgainInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Typeset_AgainInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Typeset with errors" |
*
*/
export const docs_typeset_errors: ((inputs?: Docs_Typeset_ErrorsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Typeset_ErrorsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{time}, {seconds} s" |
*
*/
export const docs_typeset_when: ((inputs: Docs_Typeset_WhenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Typeset_WhenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Typesetting…" |
*
*/
export const docs_typesetting: ((inputs?: Docs_TypesettingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_TypesettingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Word could not be drawn: {message}. Open Source." |
*
*/
export const docs_word_failed: ((inputs: Docs_Word_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Word_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "Preamble · {count} line" |
* | "other" | "Preamble · {count} lines" |
*
*/
export const docs_word_preamble: ((inputs: Docs_Word_PreambleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Docs_Word_PreambleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} added" |
*
*/
export const files_added: ((inputs: Files_AddedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_AddedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} added (already in the deck)" |
*
*/
export const files_added_reused: ((inputs: Files_Added_ReusedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Added_ReusedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Adding…" |
*
*/
export const files_adding: ((inputs?: Files_AddingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_AddingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "Adding {count} file to the card…" |
* | "other" | "Adding {count} files to the card…" |
*
*/
export const files_adding_card_many: ((inputs: Files_Adding_Card_ManyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Adding_Card_ManyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Adding {name} to the card…" |
*
*/
export const files_adding_card_one: ((inputs: Files_Adding_Card_OneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Adding_Card_OneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "Adding {count} file…" |
* | "other" | "Adding {count} files…" |
*
*/
export const files_adding_many: ((inputs: Files_Adding_ManyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Adding_ManyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Adding {name}…" |
*
*/
export const files_adding_one: ((inputs: Files_Adding_OneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Adding_OneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "All places" |
*
*/
export const files_all_places: ((inputs?: Files_All_PlacesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_All_PlacesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Asking the server about Google…" |
*
*/
export const files_asking: ((inputs?: Files_AskingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_AskingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "It goes into your message, for the agent to read." |
*
*/
export const files_attach_sub: ((inputs?: Files_Attach_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Attach_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Attach a file" |
*
*/
export const files_attach_title: ((inputs?: Files_Attach_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Attach_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cancel" |
*
*/
export const files_cancel: ((inputs?: Files_CancelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_CancelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "cancelled" |
*
*/
export const files_cancelled: ((inputs?: Files_CancelledInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_CancelledInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Documents open as pages you and your agents type into; pictures, films and sounds go on the canvas; anything else gets a board." |
*
*/
export const files_canvas_sub: ((inputs?: Files_Canvas_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Canvas_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Add a file" |
*
*/
export const files_canvas_title: ((inputs?: Files_Canvas_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Canvas_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close" |
*
*/
export const files_close: ((inputs?: Files_CloseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_CloseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close (Esc)" |
*
*/
export const files_close_title: ((inputs?: Files_Close_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Close_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the connection dropped" |
*
*/
export const files_connection_dropped: ((inputs?: Files_Connection_DroppedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Connection_DroppedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} file here" |
* | "other" | "{count} files here" |
*
*/
export const files_count: ((inputs: Files_CountInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_CountInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "That did not work." |
*
*/
export const files_did_not_work: ((inputs?: Files_Did_Not_WorkInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Did_Not_WorkInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Search your Docs, or paste a link" |
*
*/
export const files_docs_search: ((inputs?: Files_Docs_SearchInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Docs_SearchInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Search your Google Docs, or paste a Doc's link" |
*
*/
export const files_docs_search_label: ((inputs?: Files_Docs_Search_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Docs_Search_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Done" |
*
*/
export const files_done: ((inputs?: Files_DoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_DoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "It is shown on the board, where it is." |
*
*/
export const files_embed_sub: ((inputs?: Files_Embed_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Embed_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Choose a file" |
*
*/
export const files_embed_title: ((inputs?: Files_Embed_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Embed_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This folder is empty." |
*
*/
export const files_empty: ((inputs?: Files_EmptyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_EmptyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name}: {error}" |
*
*/
export const files_failed: ((inputs: Files_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Stand-in Docs on this server" |
*
*/
export const files_fake: ((inputs?: Files_FakeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_FakeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Filter" |
*
*/
export const files_filter: ((inputs?: Files_FilterInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_FilterInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Filter this folder" |
*
*/
export const files_filter_label: ((inputs?: Files_Filter_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Filter_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Google answered {status}." |
*
*/
export const files_google_answered: ((inputs: Files_Google_AnsweredInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Google_AnsweredInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} is empty" |
*
*/
export const files_is_empty: ((inputs: Files_Is_EmptyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Is_EmptyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Archive" |
*
*/
export const files_kind_archive: ((inputs?: Files_Kind_ArchiveInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Kind_ArchiveInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Audio" |
*
*/
export const files_kind_audio: ((inputs?: Files_Kind_AudioInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Kind_AudioInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "File" |
*
*/
export const files_kind_file: ((inputs?: Files_Kind_FileInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Kind_FileInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Folder" |
*
*/
export const files_kind_folder: ((inputs?: Files_Kind_FolderInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Kind_FolderInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Image" |
*
*/
export const files_kind_image: ((inputs?: Files_Kind_ImageInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Kind_ImageInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Presentation" |
*
*/
export const files_kind_presentation: ((inputs?: Files_Kind_PresentationInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Kind_PresentationInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Spreadsheet" |
*
*/
export const files_kind_spreadsheet: ((inputs?: Files_Kind_SpreadsheetInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Kind_SpreadsheetInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Table" |
*
*/
export const files_kind_table: ((inputs?: Files_Kind_TableInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Kind_TableInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Text" |
*
*/
export const files_kind_text: ((inputs?: Files_Kind_TextInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Kind_TextInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Video" |
*
*/
export const files_kind_video: ((inputs?: Files_Kind_VideoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Kind_VideoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Web page" |
*
*/
export const files_kind_web_page: ((inputs?: Files_Kind_Web_PageInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Kind_Web_PageInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Files" |
*
*/
export const files_list: ((inputs?: Files_ListInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_ListInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No Doc's name has “{query}” in it." |
*
*/
export const files_no_doc_match: ((inputs: Files_No_Doc_MatchInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_No_Doc_MatchInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No Google Docs in this account yet." |
*
*/
export const files_no_docs: ((inputs?: Files_No_DocsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_No_DocsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Nothing here matches “{filter}”." |
*
*/
export const files_no_match: ((inputs: Files_No_MatchInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_No_MatchInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "the server's answer was not JSON" |
*
*/
export const files_not_json: ((inputs?: Files_Not_JsonInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Not_JsonInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Google isn't set up on this server" |
*
*/
export const files_not_set_up: ((inputs?: Files_Not_Set_UpInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Not_Set_UpInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Put your Google Cloud project's OAuth client file at google/client.json in the server's data folder, then come back here to sign in." |
*
*/
export const files_not_set_up_note: ((inputs?: Files_Not_Set_Up_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Not_Set_Up_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "not uploaded" |
*
*/
export const files_not_uploaded: ((inputs?: Files_Not_UploadedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Not_UploadedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open the Doc at this link" |
*
*/
export const files_open_link: ((inputs?: Files_Open_LinkInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Open_LinkInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Then paste the address the browser ended on" |
*
*/
export const files_paste_address: ((inputs?: Files_Paste_AddressInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Paste_AddressInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Address after signing in" |
*
*/
export const files_paste_address_label: ((inputs?: Files_Paste_Address_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Paste_Address_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The deck and the folders it may reach" |
*
*/
export const files_path_title: ((inputs?: Files_Path_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Path_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} · {percent} of {size}" |
*
*/
export const files_progress: ((inputs: Files_ProgressInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_ProgressInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name}: {percent} of {size}" |
*
*/
export const files_progress_colon: ((inputs: Files_Progress_ColonInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Progress_ColonInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{index} of {total} · {name} · {percent} of {size}" |
*
*/
export const files_progress_nth: ((inputs: Files_Progress_NthInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Progress_NthInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} file put on the canvas" |
* | "other" | "{count} files put on the canvas" |
*
*/
export const files_put_canvas_many: ((inputs: Files_Put_Canvas_ManyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Put_Canvas_ManyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} put on the canvas" |
*
*/
export const files_put_canvas_one: ((inputs: Files_Put_Canvas_OneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Put_Canvas_OneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} file put in the card" |
* | "other" | "{count} files put in the card" |
*
*/
export const files_put_card_many: ((inputs: Files_Put_Card_ManyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Put_Card_ManyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} put in the card" |
*
*/
export const files_put_card_one: ((inputs: Files_Put_Card_OneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Put_Card_OneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This canvas was opened from a file, so it can only be read." |
*
*/
export const files_read_only_bundle: ((inputs?: Files_Read_Only_BundleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Read_Only_BundleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shared by {owner}" |
*
*/
export const files_shared_by: ((inputs: Files_Shared_ByInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Shared_ByInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Signed in" |
*
*/
export const files_signed_in: ((inputs?: Files_Signed_InInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Signed_InInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Signed in as {email}" |
*
*/
export const files_signed_in_as: ((inputs: Files_Signed_In_AsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Signed_In_AsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Signed in as {email}." |
*
*/
export const files_signed_in_sentence: ((inputs: Files_Signed_In_SentenceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Signed_In_SentenceInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign in again to see your Docs" |
*
*/
export const files_signin_again: ((inputs?: Files_Signin_AgainInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Signin_AgainInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign in with Google" |
*
*/
export const files_signin_google: ((inputs?: Files_Signin_GoogleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Signin_GoogleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Decks reads and writes the Doc as you. The sign-in is kept on this server." |
*
*/
export const files_signin_note: ((inputs?: Files_Signin_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Signin_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign in to open a Google Doc" |
*
*/
export const files_signin_title: ((inputs?: Files_Signin_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Signin_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This sign-in can open a Doc by its link, but not list your Docs." |
*
*/
export const files_stale: ((inputs?: Files_StaleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_StaleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Files" |
*
*/
export const files_tab_files: ((inputs?: Files_Tab_FilesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Tab_FilesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Google Docs" |
*
*/
export const files_tab_google: ((inputs?: Files_Tab_GoogleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Tab_GoogleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "That is the canvas as it used to be. Let go of the timeline first." |
*
*/
export const files_timeline_preview: ((inputs?: Files_Timeline_PreviewInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Timeline_PreviewInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} is larger than {size}" |
*
*/
export const files_too_large: ((inputs: Files_Too_LargeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Too_LargeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Your typing reaches Google within a couple of seconds." |
*
*/
export const files_typing_reaches: ((inputs?: Files_Typing_ReachesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Typing_ReachesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} could not be read ({status})." |
*
*/
export const files_unreadable: ((inputs: Files_UnreadableInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_UnreadableInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Up one folder" |
*
*/
export const files_up: ((inputs?: Files_UpInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_UpInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Upload from this device" |
*
*/
export const files_upload: ((inputs?: Files_UploadInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_UploadInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "It is {size}. It is copied into the deck, which takes a while and keeps that much disk." |
*
*/
export const files_upload_ask_body: ((inputs: Files_Upload_Ask_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Upload_Ask_BodyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Upload {name}?" |
*
*/
export const files_upload_ask_title: ((inputs: Files_Upload_Ask_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Upload_Ask_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "upload failed ({status})" |
*
*/
export const files_upload_failed: ((inputs: Files_Upload_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Upload_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Copy a file or photo from this device into the deck" |
*
*/
export const files_upload_title: ((inputs?: Files_Upload_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Upload_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Upload" |
*
*/
export const files_upload_yes: ((inputs?: Files_Upload_YesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_Upload_YesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{canvas} is shared with you to view, by {owner}: it follows their copy, and only they can change it. To change it, make your own copy: View only · Make a cop..." |
*
*/
export const files_view_only: ((inputs: Files_View_OnlyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_View_OnlyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{canvas} is shared with you to view, by its owner: it follows their copy, and only they can change it. To change it, make your own copy: View only · Make a c..." |
*
*/
export const files_view_only_owner: ((inputs: Files_View_Only_OwnerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_View_Only_OwnerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Where the file is" |
*
*/
export const files_where: ((inputs?: Files_WhereInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Files_WhereInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Bring the tools back" |
*
*/
export const frame_bring_tools_back: ((inputs?: Frame_Bring_Tools_BackInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Bring_Tools_BackInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Bring the pen tray back" |
*
*/
export const frame_bring_tray_back: ((inputs?: Frame_Bring_Tray_BackInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Bring_Tray_BackInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Blue" |
*
*/
export const frame_color_blue: ((inputs?: Frame_Color_BlueInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Color_BlueInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Green" |
*
*/
export const frame_color_green: ((inputs?: Frame_Color_GreenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Color_GreenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Black or white" |
*
*/
export const frame_color_ink: ((inputs?: Frame_Color_InkInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Color_InkInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Black or white, with the theme" |
*
*/
export const frame_color_ink_label: ((inputs?: Frame_Color_Ink_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Color_Ink_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Red" |
*
*/
export const frame_color_red: ((inputs?: Frame_Color_RedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Color_RedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Yellow" |
*
*/
export const frame_color_yellow: ((inputs?: Frame_Color_YellowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Color_YellowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Colour" |
*
*/
export const frame_colour: ((inputs?: Frame_ColourInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_ColourInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delete the selected strokes" |
*
*/
export const frame_delete_selected_strokes: ((inputs?: Frame_Delete_Selected_StrokesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Delete_Selected_StrokesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delete the strokes" |
*
*/
export const frame_delete_strokes: ((inputs?: Frame_Delete_StrokesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Delete_StrokesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Eraser" |
*
*/
export const frame_eraser: ((inputs?: Frame_EraserInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_EraserInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Eraser: removes each stroke it touches" |
*
*/
export const frame_eraser_label: ((inputs?: Frame_Eraser_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Eraser_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fit everything" |
*
*/
export const frame_fit: ((inputs?: Frame_FitInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_FitInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fit everything on the canvas" |
*
*/
export const frame_fit_label: ((inputs?: Frame_Fit_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Fit_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Instrument" |
*
*/
export const frame_instrument: ((inputs?: Frame_InstrumentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_InstrumentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Lasso" |
*
*/
export const frame_lasso: ((inputs?: Frame_LassoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_LassoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Lasso: loop round strokes to select them, then drag or delete" |
*
*/
export const frame_lasso_label: ((inputs?: Frame_Lasso_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Lasso_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Marker" |
*
*/
export const frame_marker: ((inputs?: Frame_MarkerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_MarkerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Marker: wide and see-through, for marking words" |
*
*/
export const frame_marker_label: ((inputs?: Frame_Marker_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Marker_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "An agent wants to take you to another canvas" |
*
*/
export const frame_offer_canvas: ((inputs?: Frame_Offer_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Offer_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "An agent wants to show you a card" |
*
*/
export const frame_offer_card: ((inputs?: Frame_Offer_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Offer_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Go" |
*
*/
export const frame_offer_go: ((inputs?: Frame_Offer_GoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Offer_GoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Stay" |
*
*/
export const frame_offer_stay: ((inputs?: Frame_Offer_StayInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Offer_StayInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Stay here" |
*
*/
export const frame_offer_stay_here: ((inputs?: Frame_Offer_Stay_HereInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Offer_Stay_HereInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "An agent wants to move the view" |
*
*/
export const frame_offer_view: ((inputs?: Frame_Offer_ViewInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Offer_ViewInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pen" |
*
*/
export const frame_pen: ((inputs?: Frame_PenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_PenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pen: draws, and presses harder with a pencil" |
*
*/
export const frame_pen_label: ((inputs?: Frame_Pen_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Pen_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pen tray" |
*
*/
export const frame_pen_tray: ((inputs?: Frame_Pen_TrayInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Pen_TrayInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Redo" |
*
*/
export const frame_redo: ((inputs?: Frame_RedoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_RedoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "App" |
*
*/
export const frame_tool_app: ((inputs?: Frame_Tool_AppInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_AppInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Arrow" |
*
*/
export const frame_tool_arrow: ((inputs?: Frame_Tool_ArrowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_ArrowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Card" |
*
*/
export const frame_tool_card: ((inputs?: Frame_Tool_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Curved connector" |
*
*/
export const frame_tool_curved: ((inputs?: Frame_Tool_CurvedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_CurvedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Diamond" |
*
*/
export const frame_tool_diamond: ((inputs?: Frame_Tool_DiamondInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_DiamondInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Elbow connector" |
*
*/
export const frame_tool_elbow: ((inputs?: Frame_Tool_ElbowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_ElbowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Ellipse" |
*
*/
export const frame_tool_ellipse: ((inputs?: Frame_Tool_EllipseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_EllipseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Add a file" |
*
*/
export const frame_tool_file: ((inputs?: Frame_Tool_FileInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_FileInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Frame" |
*
*/
export const frame_tool_frame: ((inputs?: Frame_Tool_FrameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_FrameInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Hand" |
*
*/
export const frame_tool_hand: ((inputs?: Frame_Tool_HandInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_HandInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Select with highlights" |
*
*/
export const frame_tool_highlight: ((inputs?: Frame_Tool_HighlightInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_HighlightInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Icons…" |
*
*/
export const frame_tool_icons: ((inputs?: Frame_Tool_IconsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_IconsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Line" |
*
*/
export const frame_tool_line: ((inputs?: Frame_Tool_LineInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_LineInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Link to…" |
*
*/
export const frame_tool_link: ((inputs?: Frame_Tool_LinkInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_LinkInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Markdown card" |
*
*/
export const frame_tool_markdown_card: ((inputs?: Frame_Tool_Markdown_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_Markdown_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "More shapes…" |
*
*/
export const frame_tool_more_shapes: ((inputs?: Frame_Tool_More_ShapesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_More_ShapesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Note" |
*
*/
export const frame_tool_note: ((inputs?: Frame_Tool_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Rectangle" |
*
*/
export const frame_tool_rectangle: ((inputs?: Frame_Tool_RectangleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_RectangleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Select" |
*
*/
export const frame_tool_select: ((inputs?: Frame_Tool_SelectInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_SelectInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shape" |
*
*/
export const frame_tool_shape: ((inputs?: Frame_Tool_ShapeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_ShapeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Star" |
*
*/
export const frame_tool_star: ((inputs?: Frame_Tool_StarInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_StarInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Text" |
*
*/
export const frame_tool_text: ((inputs?: Frame_Tool_TextInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_TextInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Triangle" |
*
*/
export const frame_tool_triangle: ((inputs?: Frame_Tool_TriangleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_TriangleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Hand or highlight" |
*
*/
export const frame_tool_view: ((inputs?: Frame_Tool_ViewInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tool_ViewInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Tools" |
*
*/
export const frame_tools: ((inputs?: Frame_ToolsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_ToolsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Drag to move; throw at either edge to put away; double-click to put back" |
*
*/
export const frame_tools_grip: ((inputs?: Frame_Tools_GripInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tools_GripInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Drag to move; throw at an edge to put away" |
*
*/
export const frame_tray_grip: ((inputs?: Frame_Tray_GripInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Tray_GripInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Undo" |
*
*/
export const frame_undo: ((inputs?: Frame_UndoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_UndoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Width" |
*
*/
export const frame_width: ((inputs?: Frame_WidthInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_WidthInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{px} pixels wide" |
*
*/
export const frame_width_pixels: ((inputs: Frame_Width_PixelsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Width_PixelsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{px} px" |
*
*/
export const frame_width_px: ((inputs: Frame_Width_PxInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Width_PxInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Zoom" |
*
*/
export const frame_zoom: ((inputs?: Frame_ZoomInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_ZoomInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Zoom: {percent}" |
*
*/
export const frame_zoom_at: ((inputs: Frame_Zoom_AtInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Zoom_AtInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Zoom in" |
*
*/
export const frame_zoom_in: ((inputs?: Frame_Zoom_InInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Zoom_InInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Zoom out" |
*
*/
export const frame_zoom_out: ((inputs?: Frame_Zoom_OutInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Frame_Zoom_OutInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Approve" |
*
*/
export const login_approve: ((inputs?: Login_ApproveInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_ApproveInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Code {code}" |
*
*/
export const login_approve_code: ((inputs: Login_Approve_CodeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_Approve_CodeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "A terminal asks to sign in to this Decks. Log in first to approve it." |
*
*/
export const login_approve_first: ((inputs?: Login_Approve_FirstInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_Approve_FirstInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Approve only if you started this in your terminal just now. It will act as you." |
*
*/
export const login_approve_sub: ((inputs?: Login_Approve_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_Approve_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Let {label} into this Decks?" |
*
*/
export const login_approve_title: ((inputs: Login_Approve_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_Approve_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Let a terminal into this Decks?" |
*
*/
export const login_approve_title_plain: ((inputs?: Login_Approve_Title_PlainInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_Approve_Title_PlainInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Approved. You can go back to the terminal." |
*
*/
export const login_approved: ((inputs?: Login_ApprovedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_ApprovedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cancel" |
*
*/
export const login_cancel: ((inputs?: Login_CancelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_CancelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Not approved. You can close this tab." |
*
*/
export const login_cancelled: ((inputs?: Login_CancelledInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_CancelledInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This code is unknown or has expired. Run decks login in the terminal again." |
*
*/
export const login_code_unknown: ((inputs?: Login_Code_UnknownInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_Code_UnknownInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Log in · Decks" |
*
*/
export const login_document_title: ((inputs?: Login_Document_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_Document_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Could not log in: {why}" |
*
*/
export const login_failed: ((inputs: Login_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No password is set yet, so this Decks opens for no one. Set one on the server with decks password set." |
*
*/
export const login_no_password: ((inputs?: Login_No_PasswordInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_No_PasswordInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open Decks" |
*
*/
export const login_open_decks: ((inputs?: Login_Open_DecksInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_Open_DecksInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Password" |
*
*/
export const login_password_label: ((inputs?: Login_Password_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_Password_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Log in with this Decks's password." |
*
*/
export const login_sub: ((inputs?: Login_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Log in" |
*
*/
export const login_submit: ((inputs?: Login_SubmitInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_SubmitInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Could not reach this Decks. Check the connection and try again." |
*
*/
export const login_unreachable: ((inputs?: Login_UnreachableInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_UnreachableInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "Too many tries. Try again in {count} second." |
* | "other" | "Too many tries. Try again in {count} seconds." |
*
*/
export const login_wait: ((inputs: Login_WaitInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_WaitInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "That password is not right." |
*
*/
export const login_wrong: ((inputs?: Login_WrongInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Login_WrongInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close" |
*
*/
export const markup_close: ((inputs?: Markup_CloseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Markup_CloseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close (Escape)" |
*
*/
export const markup_close_title: ((inputs?: Markup_Close_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Markup_Close_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Comment" |
*
*/
export const markup_comment: ((inputs?: Markup_CommentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Markup_CommentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Comment on the selected words" |
*
*/
export const markup_comment_label: ((inputs?: Markup_Comment_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Markup_Comment_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "What do you want to say about this?" |
*
*/
export const markup_comment_placeholder: ((inputs?: Markup_Comment_PlaceholderInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Markup_Comment_PlaceholderInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "With next message" |
*
*/
export const markup_keep: ((inputs?: Markup_KeepInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Markup_KeepInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Keep it over the input bar and send it with your next message (Enter)" |
*
*/
export const markup_keep_title: ((inputs?: Markup_Keep_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Markup_Keep_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pick an agent first" |
*
*/
export const markup_pick_agent: ((inputs?: Markup_Pick_AgentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Markup_Pick_AgentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Send now" |
*
*/
export const markup_send: ((inputs?: Markup_SendInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Markup_SendInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Send it to the agent now, as a message of its own (⌘Enter)" |
*
*/
export const markup_send_title: ((inputs?: Markup_Send_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Markup_Send_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "On the whole card" |
*
*/
export const markup_whole_card: ((inputs?: Markup_Whole_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Markup_Whole_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "On the whole card: {title}" |
*
*/
export const markup_whole_card_titled: ((inputs: Markup_Whole_Card_TitledInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Markup_Whole_Card_TitledInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Add an agent in {name}" |
*
*/
export const panel_add_agent_in: ((inputs: Panel_Add_Agent_InInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Add_Agent_InInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Add an agent in no workspace" |
*
*/
export const panel_add_agent_none: ((inputs?: Panel_Add_Agent_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Add_Agent_NoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Asleep" |
*
*/
export const panel_app_asleep: ((inputs?: Panel_App_AsleepInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_AsleepInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Broken" |
*
*/
export const panel_app_broken: ((inputs?: Panel_App_BrokenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_BrokenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Building…" |
*
*/
export const panel_app_building: ((inputs?: Panel_App_BuildingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_BuildingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{title}: double-click to run it and show it on the canvas" |
*
*/
export const panel_app_dblclick_run: ((inputs: Panel_App_Dblclick_RunInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_Dblclick_RunInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{title}: double-click to show it on the canvas" |
*
*/
export const panel_app_dblclick_show: ((inputs: Panel_App_Dblclick_ShowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_Dblclick_ShowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Installing…" |
*
*/
export const panel_app_installing: ((inputs?: Panel_App_InstallingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_InstallingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Logs" |
*
*/
export const panel_app_logs: ((inputs?: Panel_App_LogsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_LogsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close the logs" |
*
*/
export const panel_app_logs_close: ((inputs?: Panel_App_Logs_CloseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_Logs_CloseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{title}: logs" |
*
*/
export const panel_app_logs_of: ((inputs: Panel_App_Logs_OfInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_Logs_OfInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{title}'s menu" |
*
*/
export const panel_app_menu: ((inputs: Panel_App_MenuInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_MenuInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "More for {title}" |
*
*/
export const panel_app_more: ((inputs: Panel_App_MoreInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_MoreInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No app matches “{query}”." |
*
*/
export const panel_app_no_match: ((inputs: Panel_App_No_MatchInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_No_MatchInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Restart" |
*
*/
export const panel_app_restart: ((inputs?: Panel_App_RestartInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_RestartInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Running" |
*
*/
export const panel_app_running: ((inputs?: Panel_App_RunningInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_RunningInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Start" |
*
*/
export const panel_app_start: ((inputs?: Panel_App_StartInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_StartInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Starting…" |
*
*/
export const panel_app_starting: ((inputs?: Panel_App_StartingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_StartingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Stop" |
*
*/
export const panel_app_stop: ((inputs?: Panel_App_StopInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_StopInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Stopped" |
*
*/
export const panel_app_stopped: ((inputs?: Panel_App_StoppedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_StoppedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Stopping…" |
*
*/
export const panel_app_stopping: ((inputs?: Panel_App_StoppingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_App_StoppingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Looking for apps…" |
*
*/
export const panel_apps_looking: ((inputs?: Panel_Apps_LookingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Apps_LookingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This deck has no apps yet. Ask an agent for one." |
*
*/
export const panel_apps_none: ((inputs?: Panel_Apps_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Apps_NoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Arrows" |
*
*/
export const panel_arrows: ((inputs?: Panel_ArrowsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_ArrowsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Nothing on this canvas yet." |
*
*/
export const panel_canvas_empty: ((inputs?: Panel_Canvas_EmptyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Canvas_EmptyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Nothing on this canvas matches “{query}”." |
*
*/
export const panel_canvas_no_match: ((inputs: Panel_Canvas_No_MatchInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Canvas_No_MatchInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cards" |
*
*/
export const panel_cards: ((inputs?: Panel_CardsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_CardsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Clear the search" |
*
*/
export const panel_clear_search: ((inputs?: Panel_Clear_SearchInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Clear_SearchInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delete…" |
*
*/
export const panel_delete_ellipsis: ((inputs?: Panel_Delete_EllipsisInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Delete_EllipsisInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Drawing" |
*
*/
export const panel_drawing: ((inputs?: Panel_DrawingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_DrawingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fold {name}" |
*
*/
export const panel_folder_fold: ((inputs: Panel_Folder_FoldInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Folder_FoldInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show {name}" |
*
*/
export const panel_folder_show: ((inputs: Panel_Folder_ShowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Folder_ShowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Hide the side panel" |
*
*/
export const panel_hide: ((inputs?: Panel_HideInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_HideInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "New agent" |
*
*/
export const panel_new_agent: ((inputs?: Panel_New_AgentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_New_AgentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No agent matches “{query}”." |
*
*/
export const panel_no_agent_matches: ((inputs: Panel_No_Agent_MatchesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_No_Agent_MatchesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No agents yet." |
*
*/
export const panel_no_agents: ((inputs?: Panel_No_AgentsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_No_AgentsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No agents yet. Start one with `+`." |
*
*/
export const panel_no_agents_start: ((inputs?: Panel_No_Agents_StartInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_No_Agents_StartInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Nothing yet." |
*
*/
export const panel_nothing_yet: ((inputs?: Panel_Nothing_YetInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Nothing_YetInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open in a new tab" |
*
*/
export const panel_open_new_tab: ((inputs?: Panel_Open_New_TabInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Open_New_TabInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Panel" |
*
*/
export const panel_panel: ((inputs?: Panel_PanelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_PanelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Reading…" |
*
*/
export const panel_reading: ((inputs?: Panel_ReadingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_ReadingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Reload" |
*
*/
export const panel_reload: ((inputs?: Panel_ReloadInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_ReloadInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Drag to resize. Double-click to reset." |
*
*/
export const panel_resize_title: ((inputs?: Panel_Resize_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Resize_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Search agents and tags" |
*
*/
export const panel_search_agents: ((inputs?: Panel_Search_AgentsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Search_AgentsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Search apps" |
*
*/
export const panel_search_apps: ((inputs?: Panel_Search_AppsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Search_AppsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Search this canvas" |
*
*/
export const panel_search_canvas: ((inputs?: Panel_Search_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Search_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Search {name}" |
*
*/
export const panel_search_named: ((inputs: Panel_Search_NamedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Search_NamedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "On the canvas" |
*
*/
export const panel_section_canvas: ((inputs?: Panel_Section_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Section_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "In the deck" |
*
*/
export const panel_section_deck: ((inputs?: Panel_Section_DeckInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Section_DeckInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Held, not shown" |
*
*/
export const panel_section_held: ((inputs?: Panel_Section_HeldInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Section_HeldInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Settings" |
*
*/
export const panel_settings: ((inputs?: Panel_SettingsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_SettingsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show on canvas" |
*
*/
export const panel_show_on_canvas: ((inputs?: Panel_Show_On_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Show_On_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Side panel" |
*
*/
export const panel_side_panel: ((inputs?: Panel_Side_PanelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Side_PanelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sidebar width" |
*
*/
export const panel_sidebar_width: ((inputs?: Panel_Sidebar_WidthInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Sidebar_WidthInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Agents" |
*
*/
export const panel_tab_agents: ((inputs?: Panel_Tab_AgentsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Tab_AgentsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Apps" |
*
*/
export const panel_tab_apps: ((inputs?: Panel_Tab_AppsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Tab_AppsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Canvas" |
*
*/
export const panel_tab_canvas: ((inputs?: Panel_Tab_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Tab_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Recent" |
*
*/
export const panel_tab_recent: ((inputs?: Panel_Tab_RecentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Panel_Tab_RecentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "8.3 ms, 120 Hz" |
*
*/
export const perf_key_120: ((inputs?: Perf_Key_120Inputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Perf_Key_120Inputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "16.7 ms, 60 Hz" |
*
*/
export const perf_key_60: ((inputs?: Perf_Key_60Inputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Perf_Key_60Inputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Time each frame took over the last four seconds" |
*
*/
export const perf_plot_label: ((inputs?: Perf_Plot_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Perf_Plot_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "slowest {worst} ms · {missed} over 12 ms" |
*
*/
export const perf_summary: ((inputs: Perf_SummaryInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Perf_SummaryInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Allow" |
*
*/
export const settings_alert_allow: ((inputs?: Settings_Alert_AllowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_AllowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Banner" |
*
*/
export const settings_alert_banner: ((inputs?: Settings_Alert_BannerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_BannerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show a banner when an agent asks you something" |
*
*/
export const settings_alert_banner_ask: ((inputs?: Settings_Alert_Banner_AskInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_Banner_AskInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show a banner when an agent finishes" |
*
*/
export const settings_alert_banner_done: ((inputs?: Settings_Alert_Banner_DoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_Banner_DoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show a banner when something goes wrong" |
*
*/
export const settings_alert_banner_problem: ((inputs?: Settings_Alert_Banner_ProblemInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_Banner_ProblemInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This browser blocks banners for this site; turn them on in its site settings." |
*
*/
export const settings_alert_denied: ((inputs?: Settings_Alert_DeniedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_DeniedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Banners need a secure page and this one is plain http. Sounds work here; for banners, open the deck on localhost or behind TLS." |
*
*/
export const settings_alert_insecure: ((inputs?: Settings_Alert_InsecureInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_InsecureInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The browser has not been asked for permission yet." |
*
*/
export const settings_alert_not_asked: ((inputs?: Settings_Alert_Not_AskedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_Not_AskedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Silent" |
*
*/
export const settings_alert_silent: ((inputs?: Settings_Alert_SilentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_SilentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sound" |
*
*/
export const settings_alert_sound: ((inputs?: Settings_Alert_SoundInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_SoundInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sound for when an agent asks you something" |
*
*/
export const settings_alert_sound_ask: ((inputs?: Settings_Alert_Sound_AskInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_Sound_AskInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sound for when an agent finishes" |
*
*/
export const settings_alert_sound_done: ((inputs?: Settings_Alert_Sound_DoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_Sound_DoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sound for when something goes wrong" |
*
*/
export const settings_alert_sound_problem: ((inputs?: Settings_Alert_Sound_ProblemInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_Sound_ProblemInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This browser has no notifications. The sounds and the tab count still work." |
*
*/
export const settings_alert_unsupported: ((inputs?: Settings_Alert_UnsupportedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_UnsupportedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Volume" |
*
*/
export const settings_alert_volume: ((inputs?: Settings_Alert_VolumeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_VolumeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Loud" |
*
*/
export const settings_alert_volume_loud: ((inputs?: Settings_Alert_Volume_LoudInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_Volume_LoudInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Medium" |
*
*/
export const settings_alert_volume_medium: ((inputs?: Settings_Alert_Volume_MediumInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_Volume_MediumInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Off" |
*
*/
export const settings_alert_volume_off: ((inputs?: Settings_Alert_Volume_OffInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_Volume_OffInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Off silences all three and keeps the choices." |
*
*/
export const settings_alert_volume_off_sub: ((inputs?: Settings_Alert_Volume_Off_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_Volume_Off_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Quiet" |
*
*/
export const settings_alert_volume_quiet: ((inputs?: Settings_Alert_Volume_QuietInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_Volume_QuietInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "When" |
*
*/
export const settings_alert_when: ((inputs?: Settings_Alert_WhenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Alert_WhenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Canvas" |
*
*/
export const settings_canvas: ((inputs?: Settings_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Decks address" |
*
*/
export const settings_chrome_address: ((inputs?: Settings_Chrome_AddressInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Chrome_AddressInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The Decks extension" |
*
*/
export const settings_chrome_extension: ((inputs?: Settings_Chrome_ExtensionInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Chrome_ExtensionInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "New code" |
*
*/
export const settings_chrome_new_code: ((inputs?: Settings_Chrome_New_CodeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Chrome_New_CodeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Mint a fresh code; the extension has to be paired again" |
*
*/
export const settings_chrome_new_code_title: ((inputs?: Settings_Chrome_New_Code_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Chrome_New_Code_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Not paired. Paste the address and code below into the extension." |
*
*/
export const settings_chrome_not_paired: ((inputs?: Settings_Chrome_Not_PairedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Chrome_Not_PairedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Paired. Press the Decks button on a tab to share it." |
*
*/
export const settings_chrome_paired: ((inputs?: Settings_Chrome_PairedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Chrome_PairedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "Sharing one tab. Submitting asks you first." |
* | "other" | "Sharing {count} tabs. Submitting asks you first." |
*
*/
export const settings_chrome_sharing: ((inputs: Settings_Chrome_SharingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Chrome_SharingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Stop sharing" |
*
*/
export const settings_chrome_stop: ((inputs?: Settings_Chrome_StopInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Chrome_StopInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "To pair a Chrome" |
*
*/
export const settings_chrome_to_pair: ((inputs?: Settings_Chrome_To_PairInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Chrome_To_PairInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "(untitled)" |
*
*/
export const settings_chrome_untitled: ((inputs?: Settings_Chrome_UntitledInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Chrome_UntitledInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Waiting for the server." |
*
*/
export const settings_chrome_waiting: ((inputs?: Settings_Chrome_WaitingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Chrome_WaitingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Your Chrome" |
*
*/
export const settings_chrome_yours: ((inputs?: Settings_Chrome_YoursInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Chrome_YoursInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Add an account" |
*
*/
export const settings_claude_add: ((inputs?: Settings_Claude_AddInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Claude_AddInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Default for new" |
*
*/
export const settings_claude_default: ((inputs?: Settings_Claude_DefaultInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Claude_DefaultInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Each conversation picks its account in the model menu." |
*
*/
export const settings_claude_foot: ((inputs?: Settings_Claude_FootInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Claude_FootInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "An account with no name yet" |
*
*/
export const settings_claude_no_name: ((inputs?: Settings_Claude_No_NameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Claude_No_NameInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Claude Code's own login" |
*
*/
export const settings_claude_own_login: ((inputs?: Settings_Claude_Own_LoginInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Claude_Own_LoginInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Remove" |
*
*/
export const settings_claude_remove: ((inputs?: Settings_Claude_RemoveInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Claude_RemoveInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Forget {name} and remove its credentials from this machine" |
*
*/
export const settings_claude_remove_title: ((inputs: Settings_Claude_Remove_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Claude_Remove_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Signed out" |
*
*/
export const settings_claude_signed_out: ((inputs?: Settings_Claude_Signed_OutInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Claude_Signed_OutInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Subscriptions" |
*
*/
export const settings_claude_subscriptions: ((inputs?: Settings_Claude_SubscriptionsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Claude_SubscriptionsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{percent} of 5 h used" |
*
*/
export const settings_claude_used: ((inputs: Settings_Claude_UsedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Claude_UsedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close" |
*
*/
export const settings_close: ((inputs?: Settings_CloseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_CloseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Address" |
*
*/
export const settings_conn_address: ((inputs?: Settings_Conn_AddressInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Conn_AddressInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pairing code" |
*
*/
export const settings_conn_code: ((inputs?: Settings_Conn_CodeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Conn_CodeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Asked for when connecting over the internet. Make one on this machine:" |
*
*/
export const settings_conn_code_sub: ((inputs?: Settings_Conn_Code_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Conn_Code_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Connected to this Decks" |
*
*/
export const settings_conn_connected: ((inputs?: Settings_Conn_ConnectedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Conn_ConnectedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "For another Decks, the iPad app or a terminal connecting to this one. Decks Studio needs neither: its login is under Accounts." |
*
*/
export const settings_conn_foot: ((inputs?: Settings_Conn_FootInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Conn_FootInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Decks connection" |
*
*/
export const settings_conn_group: ((inputs?: Settings_Conn_GroupInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Conn_GroupInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Nothing else is connected" |
*
*/
export const settings_conn_none: ((inputs?: Settings_Conn_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Conn_NoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Revoke" |
*
*/
export const settings_conn_revoke: ((inputs?: Settings_Conn_RevokeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Conn_RevokeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Revoke all" |
*
*/
export const settings_conn_revoke_all: ((inputs?: Settings_Conn_Revoke_AllInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Conn_Revoke_AllInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "It will have to connect again" |
*
*/
export const settings_conn_revoke_title: ((inputs?: Settings_Conn_Revoke_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Conn_Revoke_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} session" |
* | "other" | "{count} sessions" |
*
*/
export const settings_conn_sessions: ((inputs: Settings_Conn_SessionsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Conn_SessionsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "unknown site" |
*
*/
export const settings_conn_unknown_site: ((inputs?: Settings_Conn_Unknown_SiteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Conn_Unknown_SiteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{site} · used {ago}" |
*
*/
export const settings_conn_used: ((inputs: Settings_Conn_UsedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Conn_UsedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Copied" |
*
*/
export const settings_copied: ((inputs?: Settings_CopiedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_CopiedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Copy" |
*
*/
export const settings_copy: ((inputs?: Settings_CopyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_CopyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Done" |
*
*/
export const settings_done: ((inputs?: Settings_DoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_DoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "5-hour window. Read {ago}." |
*
*/
export const settings_five_hour_title: ((inputs: Settings_Five_Hour_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Five_Hour_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "5-hour window, starts again at {time}. Read {ago}." |
*
*/
export const settings_five_hour_title_again: ((inputs: Settings_Five_Hour_Title_AgainInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Five_Hour_Title_AgainInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{percent} used" |
*
*/
export const settings_five_hour_used: ((inputs: Settings_Five_Hour_UsedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Five_Hour_UsedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Frame rate" |
*
*/
export const settings_fps: ((inputs?: Settings_FpsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_FpsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show the frame rate" |
*
*/
export const settings_fps_show: ((inputs?: Settings_Fps_ShowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Fps_ShowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "A meter over the canvas: frames a second, the slowest frame, and how many took over 12 ms." |
*
*/
export const settings_fps_sub: ((inputs?: Settings_Fps_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Fps_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Language" |
*
*/
export const settings_language: ((inputs?: Settings_LanguageInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_LanguageInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "As the browser ({name})" |
*
*/
export const settings_language_browser: ((inputs: Settings_Language_BrowserInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Language_BrowserInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Display language" |
*
*/
export const settings_language_row: ((inputs?: Settings_Language_RowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Language_RowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The words Decks shows, on this browser. Choosing one reloads the page." |
*
*/
export const settings_language_sub: ((inputs?: Settings_Language_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Language_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Change password" |
*
*/
export const settings_password_change: ((inputs?: Settings_Password_ChangeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_ChangeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Change" |
*
*/
export const settings_password_change_button: ((inputs?: Settings_Password_Change_ButtonInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_Change_ButtonInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "At least 10 characters. Browsers already signed in stay signed in." |
*
*/
export const settings_password_change_sub: ((inputs?: Settings_Password_Change_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_Change_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Password changed." |
*
*/
export const settings_password_changed: ((inputs?: Settings_Password_ChangedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_ChangedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Current password" |
*
*/
export const settings_password_current: ((inputs?: Settings_Password_CurrentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_CurrentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign out everywhere" |
*
*/
export const settings_password_everywhere: ((inputs?: Settings_Password_EverywhereInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_EverywhereInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign out all" |
*
*/
export const settings_password_everywhere_button: ((inputs?: Settings_Password_Everywhere_ButtonInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_Everywhere_ButtonInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Every browser and terminal that logged in with the password, this one too, has to log in again." |
*
*/
export const settings_password_everywhere_confirm_body: ((inputs?: Settings_Password_Everywhere_Confirm_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_Everywhere_Confirm_BodyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cancel" |
*
*/
export const settings_password_everywhere_confirm_no: ((inputs?: Settings_Password_Everywhere_Confirm_NoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_Everywhere_Confirm_NoInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign out everywhere?" |
*
*/
export const settings_password_everywhere_confirm_title: ((inputs?: Settings_Password_Everywhere_Confirm_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_Everywhere_Confirm_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign out everywhere" |
*
*/
export const settings_password_everywhere_confirm_yes: ((inputs?: Settings_Password_Everywhere_Confirm_YesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_Everywhere_Confirm_YesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Every browser and terminal that logged in with the password has to log in again." |
*
*/
export const settings_password_everywhere_sub: ((inputs?: Settings_Password_Everywhere_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_Everywhere_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Password" |
*
*/
export const settings_password_group: ((inputs?: Settings_Password_GroupInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_GroupInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The two new passwords are not the same." |
*
*/
export const settings_password_mismatch: ((inputs?: Settings_Password_MismatchInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_MismatchInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "New password" |
*
*/
export const settings_password_new: ((inputs?: Settings_Password_NewInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_NewInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No password is set" |
*
*/
export const settings_password_none: ((inputs?: Settings_Password_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_NoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Set one on this Mac with decks password set" |
*
*/
export const settings_password_none_sub: ((inputs?: Settings_Password_None_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_None_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This browser is not signed in with the password" |
*
*/
export const settings_password_not_this_browser: ((inputs?: Settings_Password_Not_This_BrowserInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_Not_This_BrowserInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "It reaches this Decks another way, such as from this Mac itself." |
*
*/
export const settings_password_not_this_browser_sub: ((inputs?: Settings_Password_Not_This_Browser_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_Not_This_Browser_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Repeat new password" |
*
*/
export const settings_password_repeat: ((inputs?: Settings_Password_RepeatInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_RepeatInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign out" |
*
*/
export const settings_password_sign_out: ((inputs?: Settings_Password_Sign_OutInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_Sign_OutInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Signed in with your password on this browser" |
*
*/
export const settings_password_this_browser: ((inputs?: Settings_Password_This_BrowserInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_This_BrowserInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Signing out here asks for the password again in this browser." |
*
*/
export const settings_password_this_browser_sub: ((inputs?: Settings_Password_This_Browser_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_This_Browser_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The new password needs at least 10 characters." |
*
*/
export const settings_password_too_short: ((inputs?: Settings_Password_Too_ShortInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_Too_ShortInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Could not reach this Decks." |
*
*/
export const settings_password_unreachable: ((inputs?: Settings_Password_UnreachableInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Password_UnreachableInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Accounts" |
*
*/
export const settings_section_accounts: ((inputs?: Settings_Section_AccountsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Section_AccountsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Connections" |
*
*/
export const settings_section_connections: ((inputs?: Settings_Section_ConnectionsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Section_ConnectionsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "General" |
*
*/
export const settings_section_general: ((inputs?: Settings_Section_GeneralInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Section_GeneralInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Notifications" |
*
*/
export const settings_section_notifications: ((inputs?: Settings_Section_NotificationsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Section_NotificationsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Voice" |
*
*/
export const settings_section_voice: ((inputs?: Settings_Section_VoiceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Section_VoiceInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sections" |
*
*/
export const settings_sections: ((inputs?: Settings_SectionsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_SectionsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Set" |
*
*/
export const settings_set: ((inputs?: Settings_SetInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_SetInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Studio's address" |
*
*/
export const settings_studio_address: ((inputs?: Settings_Studio_AddressInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_AddressInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cancel" |
*
*/
export const settings_studio_cancel: ((inputs?: Settings_Studio_CancelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_CancelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Code from Studio" |
*
*/
export const settings_studio_code: ((inputs?: Settings_Studio_CodeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_CodeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open Studio at {host}, copy the code it shows, and paste it below." |
*
*/
export const settings_studio_code_copy: ((inputs: Settings_Studio_Code_CopyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_Code_CopyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The code Studio shows" |
*
*/
export const settings_studio_code_label: ((inputs?: Settings_Studio_Code_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_Code_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "At {host}, in the tab that opened. Press Sign it in there, or copy the code and paste it below." |
*
*/
export const settings_studio_code_sends_back: ((inputs: Settings_Studio_Code_Sends_BackInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_Code_Sends_BackInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{host} · its key is set by DECKS_STUDIO_KEY" |
*
*/
export const settings_studio_env_key: ((inputs: Settings_Studio_Env_KeyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_Env_KeyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Decks Studio login" |
*
*/
export const settings_studio_group: ((inputs?: Settings_Studio_GroupInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_GroupInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open Studio" |
*
*/
export const settings_studio_open: ((inputs?: Settings_Studio_OpenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_OpenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Studio is showing a code" |
*
*/
export const settings_studio_showing_code: ((inputs?: Settings_Studio_Showing_CodeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_Showing_CodeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign in" |
*
*/
export const settings_studio_sign_in: ((inputs?: Settings_Studio_Sign_InInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_Sign_InInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This deck's canvases sync there, and you reach your agents from anywhere." |
*
*/
export const settings_studio_sign_in_sub: ((inputs?: Settings_Studio_Sign_In_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_Sign_In_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign in to Decks Studio" |
*
*/
export const settings_studio_sign_in_title: ((inputs?: Settings_Studio_Sign_In_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_Sign_In_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sign out" |
*
*/
export const settings_studio_sign_out: ((inputs?: Settings_Studio_Sign_OutInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_Sign_OutInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Delete this harness's Studio key: the deck stops syncing, and every browser signed in to Studio loses its way here" |
*
*/
export const settings_studio_sign_out_title: ((inputs?: Settings_Studio_Sign_Out_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_Sign_Out_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Signed in to Decks Studio" |
*
*/
export const settings_studio_signed_in: ((inputs?: Settings_Studio_Signed_InInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_Signed_InInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Signed in to Decks Studio as {email}" |
*
*/
export const settings_studio_signed_in_as: ((inputs: Settings_Studio_Signed_In_AsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_Signed_In_AsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{host} · this deck syncs there" |
*
*/
export const settings_studio_syncs_there: ((inputs: Settings_Studio_Syncs_ThereInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Studio_Syncs_ThereInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{done} of {total} · {filesDone} of {filesTotal} files" |
*
*/
export const settings_sync_amounts: ((inputs: Settings_Sync_AmountsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_AmountsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Checking what changed" |
*
*/
export const settings_sync_checking: ((inputs?: Settings_Sync_CheckingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_CheckingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Comparing this deck with Studio's copy." |
*
*/
export const settings_sync_comparing: ((inputs?: Settings_Sync_ComparingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_ComparingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Reaching Studio" |
*
*/
export const settings_sync_connecting: ((inputs?: Settings_Sync_ConnectingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_ConnectingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The first pass starts once Studio answers." |
*
*/
export const settings_sync_connecting_sub: ((inputs?: Settings_Sync_Connecting_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_Connecting_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Finishing" |
*
*/
export const settings_sync_finishing: ((inputs?: Settings_Sync_FinishingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_FinishingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Paused by Studio" |
*
*/
export const settings_sync_held: ((inputs?: Settings_Sync_HeldInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_HeldInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Studio limits how much one machine sends a minute and an hour. The rest go up when the wait ends; nothing is lost." |
*
*/
export const settings_sync_held_sub: ((inputs?: Settings_Sync_Held_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_Held_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Hide" |
*
*/
export const settings_sync_hide: ((inputs?: Settings_Sync_HideInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_HideInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Sync" |
*
*/
export const settings_sync_label: ((inputs?: Settings_Sync_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{time} left" |
*
*/
export const settings_sync_left: ((inputs: Settings_Sync_LeftInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_LeftInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} file left out" |
* | "other" | "{count} files left out" |
*
*/
export const settings_sync_left_out: ((inputs: Settings_Sync_Left_OutInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_Left_OutInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Over 50 MB, or refused by Studio: they stay on this machine." |
*
*/
export const settings_sync_left_out_sub: ((inputs?: Settings_Sync_Left_Out_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_Left_Out_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Not syncing" |
*
*/
export const settings_sync_offline: ((inputs?: Settings_Sync_OfflineInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_OfflineInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{why} Your work is safe here, and Decks tries again by itself." |
*
*/
export const settings_sync_offline_sub: ((inputs: Settings_Sync_Offline_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_Offline_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{why} Your work is safe here, and Decks tries again by itself. Last in step at {time}." |
*
*/
export const settings_sync_offline_sub_since: ((inputs: Settings_Sync_Offline_Sub_SinceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_Offline_Sub_SinceInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Try again" |
*
*/
export const settings_sync_retry: ((inputs?: Settings_Sync_RetryInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_RetryInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show" |
*
*/
export const settings_sync_show: ((inputs?: Settings_Sync_ShowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_ShowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Since {time}" |
*
*/
export const settings_sync_since: ((inputs: Settings_Sync_SinceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_SinceInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "In step with Studio" |
*
*/
export const settings_sync_synced: ((inputs?: Settings_Sync_SyncedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_SyncedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "A change here goes up within a second." |
*
*/
export const settings_sync_synced_sub: ((inputs?: Settings_Sync_Synced_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_Synced_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} canvas checked. A change here goes up within a second." |
* | "other" | "{count} canvases checked. A change here goes up within a second." |
*
*/
export const settings_sync_synced_sub_checked: ((inputs: Settings_Sync_Synced_Sub_CheckedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_Synced_Sub_CheckedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Syncing to Studio" |
*
*/
export const settings_sync_syncing: ((inputs?: Settings_Sync_SyncingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_SyncingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Studio could not be reached." |
*
*/
export const settings_sync_unreachable: ((inputs?: Settings_Sync_UnreachableInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_UnreachableInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{amounts} · {speed}/s" |
*
*/
export const settings_sync_with_speed: ((inputs: Settings_Sync_With_SpeedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Sync_With_SpeedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Time" |
*
*/
export const settings_time: ((inputs?: Settings_TimeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_TimeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Timezone" |
*
*/
export const settings_timezone: ((inputs?: Settings_TimezoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_TimezoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Back to the server's own clock, {zone}" |
*
*/
export const settings_timezone_back: ((inputs: Settings_Timezone_BackInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Timezone_BackInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "It is {time} there." |
*
*/
export const settings_timezone_now: ((inputs: Settings_Timezone_NowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Timezone_NowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Another timezone" |
*
*/
export const settings_timezone_other: ((inputs?: Settings_Timezone_OtherInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Timezone_OtherInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "An IANA name, such as Asia/Shanghai." |
*
*/
export const settings_timezone_other_sub: ((inputs?: Settings_Timezone_Other_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Timezone_Other_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Set to {zone}." |
*
*/
export const settings_timezone_set: ((inputs: Settings_Timezone_SetInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Timezone_SetInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "unknown" |
*
*/
export const settings_timezone_unknown: ((inputs?: Settings_Timezone_UnknownInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Timezone_UnknownInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Not set: the server's own clock, {zone}." |
*
*/
export const settings_timezone_unset: ((inputs: Settings_Timezone_UnsetInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Timezone_UnsetInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Use {zone}" |
*
*/
export const settings_timezone_use: ((inputs: Settings_Timezone_UseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Timezone_UseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Use the server's" |
*
*/
export const settings_timezone_use_server: ((inputs?: Settings_Timezone_Use_ServerInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Timezone_Use_ServerInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Settings" |
*
*/
export const settings_title: ((inputs?: Settings_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Agents" |
*
*/
export const settings_usage_agents: ((inputs?: Settings_Usage_AgentsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_AgentsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "API time" |
*
*/
export const settings_usage_api_time: ((inputs?: Settings_Usage_Api_TimeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Api_TimeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cache misses" |
*
*/
export const settings_usage_behavior_cache_miss: ((inputs?: Settings_Usage_Behavior_Cache_MissInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Behavior_Cache_MissInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Scheduled runs" |
*
*/
export const settings_usage_behavior_cron: ((inputs?: Settings_Usage_Behavior_CronInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Behavior_CronInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Highly parallel" |
*
*/
export const settings_usage_behavior_high_parallel: ((inputs?: Settings_Usage_Behavior_High_ParallelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Behavior_High_ParallelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Long context" |
*
*/
export const settings_usage_behavior_long_context: ((inputs?: Settings_Usage_Behavior_Long_ContextInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Behavior_Long_ContextInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Subagent-heavy" |
*
*/
export const settings_usage_behavior_subagent_heavy: ((inputs?: Settings_Usage_Behavior_Subagent_HeavyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Behavior_Subagent_HeavyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "What's using it" |
*
*/
export const settings_usage_behaviors: ((inputs?: Settings_Usage_BehaviorsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_BehaviorsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "as the runtime scans this machine" |
*
*/
export const settings_usage_behaviors_note: ((inputs?: Settings_Usage_Behaviors_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Behaviors_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cache read" |
*
*/
export const settings_usage_cache_read: ((inputs?: Settings_Usage_Cache_ReadInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Cache_ReadInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cache r/w" |
*
*/
export const settings_usage_cache_rw: ((inputs?: Settings_Usage_Cache_RwInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Cache_RwInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cache write" |
*
*/
export const settings_usage_cache_write: ((inputs?: Settings_Usage_Cache_WriteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Cache_WriteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This conversation" |
*
*/
export const settings_usage_conversation: ((inputs?: Settings_Usage_ConversationInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_ConversationInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "what it has spent, and how full its window is" |
*
*/
export const settings_usage_conversation_note: ((inputs?: Settings_Usage_Conversation_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Conversation_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cost" |
*
*/
export const settings_usage_cost: ((inputs?: Settings_Usage_CostInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_CostInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "24 hours" |
*
*/
export const settings_usage_day: ((inputs?: Settings_Usage_DayInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_DayInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "not in force" |
*
*/
export const settings_usage_dormant: ((inputs?: Settings_Usage_DormantInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_DormantInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "A window this plan carries and this account is not on right now" |
*
*/
export const settings_usage_dormant_title: ((inputs?: Settings_Usage_Dormant_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Dormant_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "not in force · turns over in {left}" |
*
*/
export const settings_usage_dormant_turns: ((inputs: Settings_Usage_Dormant_TurnsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Dormant_TurnsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Elapsed" |
*
*/
export const settings_usage_elapsed: ((inputs?: Settings_Usage_ElapsedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_ElapsedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Could not read usage: {message}" |
*
*/
export const settings_usage_failed: ((inputs: Settings_Usage_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "In" |
*
*/
export const settings_usage_in: ((inputs?: Settings_Usage_InInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_InInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Plan limits" |
*
*/
export const settings_usage_limits: ((inputs?: Settings_Usage_LimitsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_LimitsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "what the subscription has left" |
*
*/
export const settings_usage_limits_note: ((inputs?: Settings_Usage_Limits_NoteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Limits_NoteInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Lines" |
*
*/
export const settings_usage_lines: ((inputs?: Settings_Usage_LinesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_LinesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "MCP servers" |
*
*/
export const settings_usage_mcp: ((inputs?: Settings_Usage_McpInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_McpInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Model" |
*
*/
export const settings_usage_model: ((inputs?: Settings_Usage_ModelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_ModelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This agent is not running against a claude.ai plan, so there are no windows to report." |
*
*/
export const settings_usage_no_plan: ((inputs?: Settings_Usage_No_PlanInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_No_PlanInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No reading yet. An agent reports its context after its first reply." |
*
*/
export const settings_usage_no_reading: ((inputs?: Settings_Usage_No_ReadingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_No_ReadingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The plan reports no active windows." |
*
*/
export const settings_usage_no_windows: ((inputs?: Settings_Usage_No_WindowsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_No_WindowsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Nothing to report." |
*
*/
export const settings_usage_nothing: ((inputs?: Settings_Usage_NothingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_NothingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "now" |
*
*/
export const settings_usage_now: ((inputs?: Settings_Usage_NowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_NowInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "of the context window" |
*
*/
export const settings_usage_of_context: ((inputs?: Settings_Usage_Of_ContextInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Of_ContextInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Out" |
*
*/
export const settings_usage_out: ((inputs?: Settings_Usage_OutInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_OutInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "A {kind} agent bills per token and has no plan windows to run out of." |
*
*/
export const settings_usage_per_token: ((inputs: Settings_Usage_Per_TokenInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Per_TokenInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} plan" |
*
*/
export const settings_usage_plan: ((inputs: Settings_Usage_PlanInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_PlanInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Plugins" |
*
*/
export const settings_usage_plugins: ((inputs?: Settings_Usage_PluginsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_PluginsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Read again" |
*
*/
export const settings_usage_read_again: ((inputs?: Settings_Usage_Read_AgainInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Read_AgainInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Reading…" |
*
*/
export const settings_usage_reading: ((inputs?: Settings_Usage_ReadingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_ReadingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Reading again — figures from {ago}." |
*
*/
export const settings_usage_reading_again: ((inputs: Settings_Usage_Reading_AgainInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Reading_AgainInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{shown} request" |
* | "other" | "{shown} requests" |
*
*/
export const settings_usage_requests: ((inputs: Settings_Usage_RequestsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_RequestsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{requests} requests across {count} session." |
* | "other" | "{requests} requests across {count} sessions." |
*
*/
export const settings_usage_requests_across: ((inputs: Settings_Usage_Requests_AcrossInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Requests_AcrossInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "resets in {left}" |
*
*/
export const settings_usage_resets_in: ((inputs: Settings_Usage_Resets_InInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Resets_InInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "resetting now" |
*
*/
export const settings_usage_resetting: ((inputs?: Settings_Usage_ResettingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_ResettingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Skills" |
*
*/
export const settings_usage_skills: ((inputs?: Settings_Usage_SkillsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_SkillsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Usage" |
*
*/
export const settings_usage_title: ((inputs?: Settings_Usage_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{used} of {window} tokens" |
*
*/
export const settings_usage_tokens_of: ((inputs: Settings_Usage_Tokens_OfInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Tokens_OfInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "7 days" |
*
*/
export const settings_usage_week: ((inputs?: Settings_Usage_WeekInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_WeekInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Nothing recorded for this window." |
*
*/
export const settings_usage_window_empty: ((inputs?: Settings_Usage_Window_EmptyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Usage_Window_EmptyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The mic in the composer, or Ctrl+M. Nothing is sent until you send it." |
*
*/
export const settings_voice_foot: ((inputs?: Settings_Voice_FootInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Voice_FootInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The browser's speech language" |
*
*/
export const settings_voice_lang_label: ((inputs?: Settings_Voice_Lang_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Voice_Lang_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "What the browser's recogniser listens for." |
*
*/
export const settings_voice_lang_sub: ((inputs?: Settings_Voice_Lang_SubInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Voice_Lang_SubInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The server's model" |
*
*/
export const settings_voice_model: ((inputs?: Settings_Voice_ModelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Voice_ModelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The server's speech model" |
*
*/
export const settings_voice_model_label: ((inputs?: Settings_Voice_Model_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Voice_Model_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No key yet: set OPENAI_API_KEY on the server." |
*
*/
export const settings_voice_no_key: ((inputs?: Settings_Voice_No_KeyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Voice_No_KeyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Recogniser" |
*
*/
export const settings_voice_recogniser: ((inputs?: Settings_Voice_RecogniserInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Voice_RecogniserInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "$0.006 a minute; the most accurate." |
*
*/
export const settings_voice_stt_4o: ((inputs?: Settings_Voice_Stt_4oInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Voice_Stt_4oInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "$0.0045 a minute; the newest." |
*
*/
export const settings_voice_stt_gpt: ((inputs?: Settings_Voice_Stt_GptInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Voice_Stt_GptInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "$0.003 a minute; mixes languages well." |
*
*/
export const settings_voice_stt_mini: ((inputs?: Settings_Voice_Stt_MiniInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Voice_Stt_MiniInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "$0.006 a minute; the older model." |
*
*/
export const settings_voice_stt_whisper: ((inputs?: Settings_Voice_Stt_WhisperInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Settings_Voice_Stt_WhisperInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} is on this canvas" |
*
*/
export const shell_agent_here: ((inputs: Shell_Agent_HereInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Agent_HereInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Agents" |
*
*/
export const shell_agents: ((inputs?: Shell_AgentsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_AgentsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Agents, currently {name}" |
*
*/
export const shell_agents_current: ((inputs: Shell_Agents_CurrentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Agents_CurrentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Agents on this canvas" |
*
*/
export const shell_agents_here: ((inputs?: Shell_Agents_HereInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Agents_HereInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Back into the pill" |
*
*/
export const shell_back_into_pill: ((inputs?: Shell_Back_Into_PillInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Back_Into_PillInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Bring the conversation back" |
*
*/
export const shell_bring_back: ((inputs?: Shell_Bring_BackInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Bring_BackInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Canvases" |
*
*/
export const shell_canvases: ((inputs?: Shell_CanvasesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_CanvasesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Canvases, currently {name}" |
*
*/
export const shell_canvases_current: ((inputs: Shell_Canvases_CurrentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Canvases_CurrentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Canvases, this chat is on none" |
*
*/
export const shell_canvases_none: ((inputs?: Shell_Canvases_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Canvases_NoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close" |
*
*/
export const shell_close: ((inputs?: Shell_CloseInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_CloseInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Context usage" |
*
*/
export const shell_context_usage: ((inputs?: Shell_Context_UsageInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Context_UsageInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Conversation height" |
*
*/
export const shell_conversation_height: ((inputs?: Shell_Conversation_HeightInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Conversation_HeightInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Fold the conversation" |
*
*/
export const shell_fold_conversation: ((inputs?: Shell_Fold_ConversationInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Fold_ConversationInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Drag to move; let go over the side panel, or double-click, to put it back; throw at either edge to put away" |
*
*/
export const shell_grip_float: ((inputs?: Shell_Grip_FloatInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Grip_FloatInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Drag to take the conversation out of the side panel" |
*
*/
export const shell_grip_panel: ((inputs?: Shell_Grip_PanelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Grip_PanelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "More" |
*
*/
export const shell_more: ((inputs?: Shell_MoreInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_MoreInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No agent" |
*
*/
export const shell_no_agent: ((inputs?: Shell_No_AgentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_No_AgentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No canvas" |
*
*/
export const shell_no_canvas: ((inputs?: Shell_No_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_No_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Card pictures" |
*
*/
export const shell_pictures: ((inputs?: Shell_PicturesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_PicturesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Checking…" |
*
*/
export const shell_pictures_checking: ((inputs?: Shell_Pictures_CheckingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Pictures_CheckingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Every card has its pictures" |
*
*/
export const shell_pictures_done_title: ((inputs?: Shell_Pictures_Done_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Pictures_Done_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{ready} of {total} made" |
*
*/
export const shell_pictures_made: ((inputs: Shell_Pictures_MadeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Pictures_MadeInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{ready} of {total} made, {failed} failed" |
*
*/
export const shell_pictures_made_failed: ((inputs: Shell_Pictures_Made_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Pictures_Made_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Pictures of the cards are being made in the background" |
*
*/
export const shell_pictures_making_title: ((inputs?: Shell_Pictures_Making_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Pictures_Making_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "All ready" |
*
*/
export const shell_pictures_ready: ((inputs?: Shell_Pictures_ReadyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Pictures_ReadyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Present" |
*
*/
export const shell_present: ((inputs?: Shell_PresentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_PresentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show the conversation" |
*
*/
export const shell_show_conversation: ((inputs?: Shell_Show_ConversationInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Show_ConversationInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Show the side panel" |
*
*/
export const shell_show_panel: ((inputs?: Shell_Show_PanelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Show_PanelInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name} is {state}" |
*
*/
export const shell_status: ((inputs: Shell_StatusInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_StatusInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Switch agent" |
*
*/
export const shell_switch_agent: ((inputs?: Shell_Switch_AgentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Switch_AgentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Talk to {name}" |
*
*/
export const shell_talk_to: ((inputs: Shell_Talk_ToInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Talk_ToInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The conversation" |
*
*/
export const shell_the_conversation: ((inputs?: Shell_The_ConversationInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_The_ConversationInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "View only · Make a copy" |
*
*/
export const shell_view_only: ((inputs?: Shell_View_OnlyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_View_OnlyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Shared with you to view by {owner}: it follows their copy. Make your own copy to change it." |
*
*/
export const shell_view_only_title: ((inputs: Shell_View_Only_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_View_Only_TitleInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "waiting for you" |
*
*/
export const shell_waiting_for_you: ((inputs?: Shell_Waiting_For_YouInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Shell_Waiting_For_YouInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "An agent" |
*
*/
export const state_an_agent: ((inputs?: State_An_AgentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<State_An_AgentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The call failed." |
*
*/
export const state_call_failed: ((inputs?: State_Call_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<State_Call_FailedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The line to the harness dropped." |
*
*/
export const state_line_dropped: ((inputs?: State_Line_DroppedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<State_Line_DroppedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "The line to the harness dropped: {reason}." |
*
*/
export const state_line_dropped_why: ((inputs: State_Line_Dropped_WhyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<State_Line_Dropped_WhyInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name}, a tab" |
*
*/
export const tabs_a_tab: ((inputs: Tabs_A_TabInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_A_TabInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "{name}: actions" |
*
*/
export const tabs_actions: ((inputs: Tabs_ActionsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_ActionsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "All tabs" |
*
*/
export const tabs_all_tabs: ((inputs?: Tabs_All_TabsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_All_TabsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Apps" |
*
*/
export const tabs_apps: ((inputs?: Tabs_AppsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_AppsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Canvases" |
*
*/
export const tabs_canvases: ((inputs?: Tabs_CanvasesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_CanvasesInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This card is not in the deck any more." |
*
*/
export const tabs_card_gone: ((inputs?: Tabs_Card_GoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Card_GoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Cards" |
*
*/
export const tabs_cards: ((inputs?: Tabs_CardsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_CardsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close {name}" |
*
*/
export const tabs_close_named: ((inputs: Tabs_Close_NamedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Close_NamedInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Close the tab" |
*
*/
export const tabs_close_tab: ((inputs?: Tabs_Close_TabInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Close_TabInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Document" |
*
*/
export const tabs_document: ((inputs?: Tabs_DocumentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_DocumentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This document is not in the deck any more." |
*
*/
export const tabs_document_gone: ((inputs?: Tabs_Document_GoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Document_GoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This document is kept in the deck's own docs, on no canvas." |
*
*/
export const tabs_document_no_canvas: ((inputs?: Tabs_Document_No_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Document_No_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Documents" |
*
*/
export const tabs_documents: ((inputs?: Tabs_DocumentsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_DocumentsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Find a canvas, an app, a card or a document" |
*
*/
export const tabs_find: ((inputs?: Tabs_FindInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_FindInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This link's target is not in the deck any more: {target}." |
*
*/
export const tabs_link_gone: ((inputs: Tabs_Link_GoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Link_GoneInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This link's app is not in the deck any more: {target}." |
*
*/
export const tabs_link_gone_app: ((inputs: Tabs_Link_Gone_AppInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Link_Gone_AppInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This link's canvas is not in the deck any more: {target}." |
*
*/
export const tabs_link_gone_canvas: ((inputs: Tabs_Link_Gone_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Link_Gone_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This link's card is not in the deck any more: {target}." |
*
*/
export const tabs_link_gone_card: ((inputs: Tabs_Link_Gone_CardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Link_Gone_CardInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This link's document is not in the deck any more: {target}." |
*
*/
export const tabs_link_gone_document: ((inputs: Tabs_Link_Gone_DocumentInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Link_Gone_DocumentInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This link opens nothing: {address} is not an address of a canvas, a card, a document or an app." |
*
*/
export const tabs_link_nothing: ((inputs: Tabs_Link_NothingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Link_NothingInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Link to" |
*
*/
export const tabs_link_to: ((inputs?: Tabs_Link_ToInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Link_ToInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Link to a canvas, an app, a card or a document" |
*
*/
export const tabs_link_to_find: ((inputs?: Tabs_Link_To_FindInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Link_To_FindInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "No canvas" |
*
*/
export const tabs_no_canvas: ((inputs?: Tabs_No_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_No_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "It is not on {canvas} any more." |
*
*/
export const tabs_not_on_canvas: ((inputs: Tabs_Not_On_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Not_On_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "On canvas" |
*
*/
export const tabs_on_canvas: ((inputs?: Tabs_On_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_On_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Go to where it sits on a canvas" |
*
*/
export const tabs_on_canvas_tip: ((inputs?: Tabs_On_Canvas_TipInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_On_Canvas_TipInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "This is on no canvas." |
*
*/
export const tabs_on_no_canvas: ((inputs?: Tabs_On_No_CanvasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_On_No_CanvasInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open a tab" |
*
*/
export const tabs_open_a_tab: ((inputs?: Tabs_Open_A_TabInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Open_A_TabInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | n | output |
* | --- | --- |
* | "one" | "{count} tab open" |
* | "other" | "{count} tabs open" |
*
*/
export const tabs_open_count: ((inputs: Tabs_Open_CountInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Open_CountInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Open in the browser's tab" |
*
*/
export const tabs_open_in_browser: ((inputs?: Tabs_Open_In_BrowserInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Open_In_BrowserInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Reload" |
*
*/
export const tabs_reload: ((inputs?: Tabs_ReloadInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_ReloadInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Load it again, in this tab" |
*
*/
export const tabs_reload_tip: ((inputs?: Tabs_Reload_TipInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_Reload_TipInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Tabs" |
*
*/
export const tabs_tabs: ((inputs?: Tabs_TabsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Tabs_TabsInputs, { locale?: "en" | "zh-CN" }, {}>;
/**
* | output |
* | --- |
* | "Write here with the pencil; the words go into the field being edited" |
*
*/
export const ui_scribble_label: ((inputs?: Ui_Scribble_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & __ParaglideMessageMetadata<Ui_Scribble_LabelInputs, { locale?: "en" | "zh-CN" }, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Agents_AddInputs = {};
export type Agents_Add_TitleInputs = { label: NonNullable<unknown> };
export type Agents_AgentsInputs = {};
export type Agents_Browse_LabelInputs = {};
export type Agents_Browse_TitleInputs = {};
export type Agents_CloseInputs = { name: NonNullable<unknown> };
export type Agents_Close_TitleInputs = { name: NonNullable<unknown> };
export type Agents_Dialog_AllowInputs = {};
export type Agents_Dialog_CancelInputs = {};
export type Agents_Dialog_CustomInputs = {};
export type Agents_Dialog_DenyInputs = {};
export type Agents_Dialog_DismissInputs = {};
export type Agents_Dialog_DoneInputs = {};
export type Agents_Dialog_OtherInputs = {};
export type Agents_Dialog_Paste_CodeInputs = {};
export type Agents_Dialog_SendInputs = {};
export type Agents_Dialog_Sign_InInputs = {};
export type Agents_Dialog_Something_ElseInputs = {};
export type Agents_DormantInputs = {};
export type Agents_DrawInputs = {};
export type Agents_Edit_Add_TagInputs = {};
export type Agents_Edit_CloseInputs = {};
export type Agents_Edit_LabelInputs = { name: NonNullable<unknown> };
export type Agents_Edit_NameInputs = {};
export type Agents_Edit_Name_LabelInputs = {};
export type Agents_Edit_Name_TakenInputs = { name: NonNullable<unknown> };
export type Agents_Edit_New_WorkspaceInputs = {};
export type Agents_Edit_Remove_TagInputs = { tag: NonNullable<unknown> };
export type Agents_Edit_TagsInputs = {};
export type Agents_FindInputs = {};
export type Agents_Find_NoneInputs = {};
export type Agents_Hover_ClickInputs = { name: NonNullable<unknown> };
export type Agents_Just_NowInputs = {};
export type Agents_Menu_MoreInputs = { count: NonNullable<unknown>, shown: NonNullable<unknown> };
export type Agents_Menu_More_OpenInputs = { count: NonNullable<unknown>, shown: NonNullable<unknown> };
export type Agents_Menu_MoveInputs = {};
export type Agents_Menu_RemoveInputs = {};
export type Agents_Menu_Remove_BusyInputs = {};
export type Agents_Menu_RenameInputs = {};
export type Agents_Menu_StopInputs = {};
export type Agents_Menu_Stop_IdleInputs = {};
export type Agents_Menu_TagsInputs = {};
export type Agents_Menu_TalkInputs = {};
export type Agents_ModeInputs = {};
export type Agents_NewInputs = {};
export type Agents_No_WorkspaceInputs = {};
export type Agents_NoneInputs = {};
export type Agents_Not_InstalledInputs = {};
export type Agents_Outside_AwayInputs = { ago: NonNullable<unknown> };
export type Agents_Outside_CallingInputs = {};
export type Agents_Outside_HereInputs = {};
export type Agents_Outside_Last_CallInputs = { ago: NonNullable<unknown> };
export type Agents_Outside_Messages_WaitInputs = { count: NonNullable<unknown>, shown: NonNullable<unknown> };
export type Agents_Outside_WaitingInputs = { count: NonNullable<unknown> };
export type Agents_Outside_WorksInputs = { client: NonNullable<unknown> };
export type Agents_PanelInputs = {};
export type Agents_Pill_LabelInputs = { name: NonNullable<unknown> };
export type Agents_QuoteInputs = { text: NonNullable<unknown> };
export type Agents_Row_Current_TitleInputs = { name: NonNullable<unknown> };
export type Agents_Row_MenuInputs = { name: NonNullable<unknown> };
export type Agents_Row_More_LabelInputs = { name: NonNullable<unknown> };
export type Agents_Row_More_TitleInputs = { name: NonNullable<unknown> };
export type Agents_Row_NewInputs = {};
export type Agents_Row_NowInputs = {};
export type Agents_Section_WantsInputs = { count: NonNullable<unknown>, shown: NonNullable<unknown> };
export type Agents_Section_WorkingInputs = { count: NonNullable<unknown> };
export type Agents_Side_Panel_HideInputs = {};
export type Agents_Side_Panel_ShowInputs = {};
export type Agents_Side_Panel_TitleInputs = {};
export type Agents_Stack_LabelInputs = {};
export type Agents_Stack_MoreInputs = { count: NonNullable<unknown>, shown: NonNullable<unknown> };
export type Agents_Stack_SwitchInputs = { name: NonNullable<unknown>, status: NonNullable<unknown> };
export type Agents_Stage_LabelInputs = { name: NonNullable<unknown> };
export type Agents_Stage_NoneInputs = {};
export type Agents_Stage_TitleInputs = { name: NonNullable<unknown> };
export type Agents_StagesInputs = {};
export type Agents_Status_DoneInputs = {};
export type Agents_Status_IdleInputs = {};
export type Agents_Status_ThinkingInputs = {};
export type Agents_Status_ToolInputs = {};
export type Agents_Status_TypingInputs = {};
export type Agents_Status_WaitingInputs = {};
export type Agents_SwitchInputs = {};
export type Agents_Switch_ToInputs = { name: NonNullable<unknown> };
export type Agents_Tag_MineInputs = { tag: NonNullable<unknown> };
export type Agents_Tag_TheirsInputs = { name: NonNullable<unknown>, tag: NonNullable<unknown> };
export type Agents_View_OnlyInputs = {};
export type Agents_View_Only_TitleInputs = { owner: NonNullable<unknown> };
export type Agents_WorkspaceInputs = {};
export type Agents_Ws_CreateInputs = {};
export type Agents_Ws_Name_LabelInputs = {};
export type Agents_Ws_Name_PlaceholderInputs = {};
export type Agents_Ws_NamedInputs = {};
export type App_CancelInputs = {};
export type App_Clear_CanvasInputs = {};
export type App_Dark_ModeInputs = {};
export type App_DeleteInputs = {};
export type App_Delete_App_BodyInputs = { folder: NonNullable<unknown> };
export type App_Delete_App_TitleInputs = { name: NonNullable<unknown> };
export type App_Dest_NoneInputs = {};
export type App_Dest_NoteInputs = { card: NonNullable<unknown> };
export type App_Dest_ToInputs = { name: NonNullable<unknown> };
export type App_File_Open_FailedInputs = { name: NonNullable<unknown>, error: NonNullable<unknown> };
export type App_FinishedInputs = { name: NonNullable<unknown> };
export type App_GoInputs = {};
export type App_No_Card_AtInputs = { path: NonNullable<unknown> };
export type App_Not_On_CanvasInputs = {};
export type App_Notes_Not_BuiltInputs = {};
export type App_OpenInputs = {};
export type App_Open_TabInputs = {};
export type App_Own_CopyInputs = { name: NonNullable<unknown> };
export type App_Pick_AgentInputs = {};
export type App_Picture_FailedInputs = { error: NonNullable<unknown> };
export type App_Server_AnsweredInputs = { status: NonNullable<unknown> };
export type App_SettingsInputs = {};
export type App_ShortcutsInputs = {};
export type App_ShowInputs = {};
export type App_Something_On_CanvasInputs = {};
export type App_Something_WrongInputs = {};
export type App_Stow_BackInputs = {};
export type App_Taking_PictureInputs = {};
export type App_WaitingInputs = { name: NonNullable<unknown> };
export type App_Wants_GotoInputs = { name: NonNullable<unknown>, canvas: NonNullable<unknown> };
export type App_Wants_ShowInputs = { name: NonNullable<unknown>, what: NonNullable<unknown> };
export type Canvas_App_Close_TitleInputs = {};
export type Canvas_App_CollapseInputs = {};
export type Canvas_App_Collapse_TitleInputs = {};
export type Canvas_App_Needs_DecksInputs = {};
export type Canvas_App_Not_OpenedInputs = { status: NonNullable<unknown> };
export type Canvas_App_OpenInputs = {};
export type Canvas_App_Open_TabInputs = {};
export type Canvas_App_OpeningInputs = { name: NonNullable<unknown> };
export type Canvas_App_Own_TabInputs = { name: NonNullable<unknown> };
export type Canvas_Card_AcceptInputs = {};
export type Canvas_Card_Block_BodyInputs = {};
export type Canvas_Card_Block_CodeInputs = {};
export type Canvas_Card_Block_H1Inputs = {};
export type Canvas_Card_Block_H2Inputs = {};
export type Canvas_Card_Block_H3Inputs = {};
export type Canvas_Card_Block_QuoteInputs = {};
export type Canvas_Card_Block_TitleInputs = {};
export type Canvas_Card_BoldInputs = {};
export type Canvas_Card_CheckInputs = {};
export type Canvas_Card_ClearInputs = {};
export type Canvas_Card_CodeInputs = {};
export type Canvas_Card_Colour_BlueInputs = {};
export type Canvas_Card_Colour_GreenInputs = {};
export type Canvas_Card_Colour_OrangeInputs = {};
export type Canvas_Card_Colour_PurpleInputs = {};
export type Canvas_Card_Colour_RedInputs = {};
export type Canvas_Card_Colour_YellowInputs = {};
export type Canvas_Card_Font_DefaultInputs = {};
export type Canvas_Card_Fonts_DisplayInputs = {};
export type Canvas_Card_Fonts_MonoInputs = {};
export type Canvas_Card_Fonts_SansInputs = {};
export type Canvas_Card_Fonts_SerifInputs = {};
export type Canvas_Card_Held_ItemInputs = {};
export type Canvas_Card_HighlightInputs = {};
export type Canvas_Card_Highlight_ColourInputs = { colour: NonNullable<unknown> };
export type Canvas_Card_ImageInputs = {};
export type Canvas_Card_ItalicInputs = {};
export type Canvas_Card_LinkInputs = {};
export type Canvas_Card_Link_PromptInputs = {};
export type Canvas_Card_No_ColourInputs = {};
export type Canvas_Card_No_HighlightInputs = {};
export type Canvas_Card_OlInputs = {};
export type Canvas_Card_RedoInputs = {};
export type Canvas_Card_RejectInputs = {};
export type Canvas_Card_RuleInputs = {};
export type Canvas_Card_Scripts_OffInputs = {};
export type Canvas_Card_Scripts_Off_TitleInputs = {};
export type Canvas_Card_SizeInputs = {};
export type Canvas_Card_Size_HugeInputs = {};
export type Canvas_Card_Size_LargeInputs = {};
export type Canvas_Card_Size_NormalInputs = {};
export type Canvas_Card_Size_SmallInputs = {};
export type Canvas_Card_StrikeInputs = {};
export type Canvas_Card_Tab_ActualInputs = {};
export type Canvas_Card_Tab_Fit_TitleInputs = {};
export type Canvas_Card_TableInputs = {};
export type Canvas_Card_Text_ColourInputs = { colour: NonNullable<unknown> };
export type Canvas_Card_UlInputs = {};
export type Canvas_Card_UnderlineInputs = {};
export type Canvas_Card_UndoInputs = {};
export type Canvas_Color_Accent_BlueInputs = {};
export type Canvas_Color_Accent_GreenInputs = {};
export type Canvas_Color_Accent_OrangeInputs = {};
export type Canvas_Color_Accent_PurpleInputs = {};
export type Canvas_Color_Accent_RedInputs = {};
export type Canvas_Color_Accent_YellowInputs = {};
export type Canvas_Color_AdaptiveInputs = {};
export type Canvas_Color_Adaptive_GroupInputs = {};
export type Canvas_Color_Adaptive_TitleInputs = { name: NonNullable<unknown>, light: NonNullable<unknown>, dark: NonNullable<unknown> };
export type Canvas_Color_ColoursInputs = {};
export type Canvas_Color_DropperInputs = {};
export type Canvas_Color_Fill_BlueInputs = {};
export type Canvas_Color_Fill_GrayInputs = {};
export type Canvas_Color_Fill_GreenInputs = {};
export type Canvas_Color_Fill_OrangeInputs = {};
export type Canvas_Color_Fill_PurpleInputs = {};
export type Canvas_Color_Fill_RedInputs = {};
export type Canvas_Color_Fill_SkyInputs = {};
export type Canvas_Color_Fill_SlateInputs = {};
export type Canvas_Color_Fill_YellowInputs = {};
export type Canvas_Color_HexInputs = { label: NonNullable<unknown> };
export type Canvas_Color_HueInputs = {};
export type Canvas_Color_LineInputs = {};
export type Canvas_Color_Line_StrongInputs = {};
export type Canvas_Color_Line_SubtleInputs = {};
export type Canvas_Color_PickerInputs = { label: NonNullable<unknown> };
export type Canvas_Color_ShadeInputs = {};
export type Canvas_Color_SurfaceInputs = {};
export type Canvas_Color_TextInputs = {};
export type Canvas_Color_Text_MutedInputs = {};
export type Canvas_Copy_FailedInputs = { why: NonNullable<unknown> };
export type Canvas_Copy_No_AnswerInputs = {};
export type Canvas_Cursor_AgentInputs = {};
export type Canvas_Document_Needs_FrameInputs = {};
export type Canvas_Frame_TitleInputs = {};
export type Canvas_Handle_Arrow_BendInputs = {};
export type Canvas_Handle_Arrow_JoinInputs = {};
export type Canvas_Handle_Arrow_JoinedInputs = {};
export type Canvas_Handle_CornersInputs = {};
export type Canvas_Handle_Draw_ArrowInputs = {};
export type Canvas_Handle_Move_BlockInputs = {};
export type Canvas_Hold_Add_IconInputs = {};
export type Canvas_Hold_Add_ShapeInputs = {};
export type Canvas_Hold_An_ItemInputs = {};
export type Canvas_Hold_AskInputs = {};
export type Canvas_Hold_DrawerInputs = {};
export type Canvas_Hold_To_FrontInputs = {};
export type Canvas_Ink_Color_BlueInputs = {};
export type Canvas_Ink_Color_GreenInputs = {};
export type Canvas_Ink_Color_InkInputs = {};
export type Canvas_Ink_Color_RedInputs = {};
export type Canvas_Ink_Color_YellowInputs = {};
export type Canvas_Ink_DeleteInputs = {};
export type Canvas_Ink_Delete_TitleInputs = {};
export type Canvas_Ink_EraserInputs = {};
export type Canvas_Ink_LassoInputs = {};
export type Canvas_Ink_MarkerInputs = {};
export type Canvas_Ink_PenInputs = {};
export type Canvas_Ink_StopInputs = {};
export type Canvas_Ink_Stop_TitleInputs = {};
export type Canvas_Ink_Undo_TitleInputs = {};
export type Canvas_Ink_WidthInputs = { px: NonNullable<unknown> };
export type Canvas_Insert_FoundInputs = { count: NonNullable<unknown> };
export type Canvas_Insert_HintInputs = {};
export type Canvas_Insert_Hint_AtInputs = {};
export type Canvas_Insert_Hint_ReplaceInputs = {};
export type Canvas_Insert_IconsInputs = {};
export type Canvas_Insert_Icons_FailedInputs = {};
export type Canvas_Insert_Icons_LoadingInputs = {};
export type Canvas_Insert_MoreInputs = {};
export type Canvas_Insert_No_IconInputs = {};
export type Canvas_Insert_No_ShapeInputs = {};
export type Canvas_Insert_RecentInputs = {};
export type Canvas_Insert_Search_IconsInputs = {};
export type Canvas_Insert_Search_ShapesInputs = {};
export type Canvas_Insert_ShapesInputs = {};
export type Canvas_Media_FullscreenInputs = {};
export type Canvas_Media_MuteInputs = {};
export type Canvas_Media_PauseInputs = {};
export type Canvas_Media_PlayInputs = {};
export type Canvas_Media_SeekInputs = {};
export type Canvas_Media_UnmuteInputs = {};
export type Canvas_Paste_Kind_CardInputs = {};
export type Canvas_Paste_Kind_DocumentInputs = {};
export type Canvas_Paste_Kind_FileInputs = {};
export type Canvas_Paste_Kind_PictureInputs = {};
export type Canvas_Paste_Link_FailedInputs = {};
export type Canvas_Paste_Needs_FilesInputs = { what: NonNullable<unknown> };
export type Canvas_Paste_NothingInputs = {};
export type Canvas_Paste_Read_OnlyInputs = {};
export type Canvas_Pill_CardsInputs = { count: NonNullable<unknown> };
export type Canvas_Pill_Cards_And_ItemsInputs = { cards: NonNullable<unknown>, items: NonNullable<unknown> };
export type Canvas_Pill_CommentInputs = {};
export type Canvas_Pill_Comment_CardInputs = {};
export type Canvas_Pill_Comment_ThisInputs = {};
export type Canvas_Pill_Copy_PathInputs = {};
export type Canvas_Pill_DeleteInputs = {};
export type Canvas_Pill_Delete_CardInputs = {};
export type Canvas_Pill_Delete_DocumentInputs = {};
export type Canvas_Pill_DuplicateInputs = {};
export type Canvas_Pill_Export_PdfInputs = {};
export type Canvas_Pill_Export_PngInputs = {};
export type Canvas_Pill_FitInputs = {};
export type Canvas_Pill_Fit_TitleInputs = {};
export type Canvas_Pill_HideInputs = {};
export type Canvas_Pill_Hide_AppInputs = {};
export type Canvas_Pill_Hide_TitleInputs = {};
export type Canvas_Pill_Ink_CardInputs = {};
export type Canvas_Pill_Ink_Card_TitleInputs = { agent: NonNullable<unknown> };
export type Canvas_Pill_Ink_DrawingInputs = {};
export type Canvas_Pill_Ink_Drawing_TitleInputs = { agent: NonNullable<unknown> };
export type Canvas_Pill_Ink_SendInputs = { agent: NonNullable<unknown> };
export type Canvas_Pill_Ink_Send_TitleInputs = { agent: NonNullable<unknown> };
export type Canvas_Pill_MoreInputs = {};
export type Canvas_Pill_More_ActionsInputs = {};
export type Canvas_Pill_More_CardInputs = {};
export type Canvas_Pill_New_TabInputs = {};
export type Canvas_Pill_New_Tab_TitleInputs = {};
export type Canvas_Pill_ReloadInputs = {};
export type Canvas_Pill_Reload_TitleInputs = {};
export type Canvas_Pill_StrokesInputs = { count: NonNullable<unknown> };
export type Canvas_Pill_The_AgentInputs = {};
export type Canvas_Pill_Zoom_ToInputs = {};
export type Canvas_Presence_AgentInputs = {};
export type Canvas_Presence_ElsewhereInputs = {};
export type Canvas_Presence_WindowInputs = {};
export type Canvas_Props_AlignInputs = {};
export type Canvas_Props_Align_BottomInputs = {};
export type Canvas_Props_Align_CentreInputs = {};
export type Canvas_Props_Align_LeftInputs = {};
export type Canvas_Props_Align_MiddleInputs = {};
export type Canvas_Props_Align_RightInputs = {};
export type Canvas_Props_Align_TopInputs = {};
export type Canvas_Props_AlignmentInputs = {};
export type Canvas_Props_AngleInputs = {};
export type Canvas_Props_ArrangeInputs = {};
export type Canvas_Props_Arrow_BendInputs = {};
export type Canvas_Props_Arrow_Bend_AutoInputs = {};
export type Canvas_Props_Arrow_Bend_CustomInputs = {};
export type Canvas_Props_Arrow_Bend_ResetInputs = {};
export type Canvas_Props_Arrow_CurvedInputs = {};
export type Canvas_Props_Arrow_ElbowInputs = {};
export type Canvas_Props_Arrow_End_NothingInputs = {};
export type Canvas_Props_Arrow_End_PointInputs = {};
export type Canvas_Props_Arrow_End_SideInputs = {};
export type Canvas_Props_Arrow_Head_BothInputs = {};
export type Canvas_Props_Arrow_Head_EndInputs = {};
export type Canvas_Props_Arrow_Head_NoneInputs = {};
export type Canvas_Props_Arrow_HeadsInputs = {};
export type Canvas_Props_Arrow_MiddleInputs = {};
export type Canvas_Props_Arrow_Middle_TitleInputs = {};
export type Canvas_Props_Arrow_RouteInputs = {};
export type Canvas_Props_Arrow_Start_SideInputs = {};
export type Canvas_Props_Arrow_StraightInputs = {};
export type Canvas_Props_Arrow_Words_HintInputs = {};
export type Canvas_Props_At_BottomInputs = {};
export type Canvas_Props_At_MiddleInputs = {};
export type Canvas_Props_At_TopInputs = {};
export type Canvas_Props_AutoInputs = {};
export type Canvas_Props_BlurInputs = {};
export type Canvas_Props_Blur_ShortInputs = {};
export type Canvas_Props_BoldInputs = {};
export type Canvas_Props_CloseInputs = {};
export type Canvas_Props_ColourInputs = {};
export type Canvas_Props_CornersInputs = {};
export type Canvas_Props_Dash_DashedInputs = {};
export type Canvas_Props_Dash_DottedInputs = {};
export type Canvas_Props_Dash_SolidInputs = {};
export type Canvas_Props_DashesInputs = {};
export type Canvas_Props_DeleteInputs = {};
export type Canvas_Props_DeselectInputs = {};
export type Canvas_Props_Distribute_XInputs = {};
export type Canvas_Props_Distribute_YInputs = {};
export type Canvas_Props_DuplicateInputs = {};
export type Canvas_Props_EffectsInputs = {};
export type Canvas_Props_Export_ObsidianInputs = {};
export type Canvas_Props_Export_PngInputs = {};
export type Canvas_Props_FillInputs = {};
export type Canvas_Props_Fill_ColourInputs = {};
export type Canvas_Props_Fill_LinearInputs = {};
export type Canvas_Props_Fill_NoneInputs = {};
export type Canvas_Props_Fill_RadialInputs = {};
export type Canvas_Props_Fill_SolidInputs = {};
export type Canvas_Props_Flip_XInputs = {};
export type Canvas_Props_Flip_YInputs = {};
export type Canvas_Props_FontInputs = {};
export type Canvas_Props_Font_SizeInputs = {};
export type Canvas_Props_FromInputs = {};
export type Canvas_Props_Google_FontInputs = {};
export type Canvas_Props_Google_Font_TitleInputs = {};
export type Canvas_Props_Icon_ColourInputs = {};
export type Canvas_Props_Icon_LibraryInputs = {};
export type Canvas_Props_Icon_NameInputs = {};
export type Canvas_Props_Icon_PickInputs = {};
export type Canvas_Props_Icon_Pick_TitleInputs = {};
export type Canvas_Props_Icon_WeightInputs = {};
export type Canvas_Props_ItalicInputs = {};
export type Canvas_Props_ItemsInputs = { count: NonNullable<unknown> };
export type Canvas_Props_Keep_RatioInputs = {};
export type Canvas_Props_Keeping_RatioInputs = {};
export type Canvas_Props_Kind_ArrowInputs = {};
export type Canvas_Props_Kind_CardInputs = {};
export type Canvas_Props_Kind_EllipseInputs = {};
export type Canvas_Props_Kind_FrameInputs = {};
export type Canvas_Props_Kind_GroupInputs = {};
export type Canvas_Props_Kind_IconInputs = {};
export type Canvas_Props_Kind_ImageInputs = {};
export type Canvas_Props_Kind_LineInputs = {};
export type Canvas_Props_Kind_NoteInputs = {};
export type Canvas_Props_Kind_PathInputs = {};
export type Canvas_Props_Kind_PolygonInputs = {};
export type Canvas_Props_Kind_RectangleInputs = {};
export type Canvas_Props_Kind_ShapeInputs = {};
export type Canvas_Props_Kind_TextInputs = {};
export type Canvas_Props_LayoutInputs = {};
export type Canvas_Props_Letter_SpacingInputs = {};
export type Canvas_Props_LineInputs = {};
export type Canvas_Props_Line_AlignInputs = {};
export type Canvas_Props_Line_CentreInputs = {};
export type Canvas_Props_Line_ColourInputs = {};
export type Canvas_Props_Line_HeightInputs = {};
export type Canvas_Props_Line_InsideInputs = {};
export type Canvas_Props_Line_OutsideInputs = {};
export type Canvas_Props_MixedInputs = {};
export type Canvas_Props_NameInputs = {};
export type Canvas_Props_OpacityInputs = {};
export type Canvas_Props_Order_ActionsInputs = {};
export type Canvas_Props_PanelInputs = {};
export type Canvas_Props_PaperInputs = {};
export type Canvas_Props_Pick_AnyInputs = { what: NonNullable<unknown> };
export type Canvas_Props_PlaceInputs = {};
export type Canvas_Props_RadiusInputs = {};
export type Canvas_Props_RotationInputs = {};
export type Canvas_Props_Second_ColourInputs = {};
export type Canvas_Props_ShadowInputs = {};
export type Canvas_Props_Shadow_ColourInputs = {};
export type Canvas_Props_ShapeInputs = {};
export type Canvas_Props_Shape_KindInputs = {};
export type Canvas_Props_Shape_Kind_LabelInputs = {};
export type Canvas_Props_Shape_Words_HintInputs = {};
export type Canvas_Props_Side_BottomInputs = {};
export type Canvas_Props_Side_LeftInputs = {};
export type Canvas_Props_Side_NearestInputs = {};
export type Canvas_Props_Side_RightInputs = {};
export type Canvas_Props_Side_TopInputs = {};
export type Canvas_Props_SidesInputs = {};
export type Canvas_Props_Sides_CornersInputs = {};
export type Canvas_Props_Spread_ShortInputs = {};
export type Canvas_Props_StyleInputs = {};
export type Canvas_Props_SwatchInputs = { label: NonNullable<unknown>, color: NonNullable<unknown> };
export type Canvas_Props_Text_ColourInputs = {};
export type Canvas_Props_ToInputs = {};
export type Canvas_Props_To_BackInputs = {};
export type Canvas_Props_To_FrontInputs = {};
export type Canvas_Props_VerticalInputs = {};
export type Canvas_Props_WidthInputs = {};
export type Canvas_Props_WordsInputs = {};
export type Canvas_Props_Words_In_ShapeInputs = {};
export type Canvas_RedoInputs = {};
export type Canvas_Redo_TitleInputs = {};
export type Canvas_Shape_Arrow_BothInputs = {};
export type Canvas_Shape_Arrow_RightInputs = {};
export type Canvas_Shape_BraceInputs = {};
export type Canvas_Shape_CardInputs = {};
export type Canvas_Shape_ChevronInputs = {};
export type Canvas_Shape_CloudInputs = {};
export type Canvas_Shape_DataInputs = {};
export type Canvas_Shape_DatabaseInputs = {};
export type Canvas_Shape_DecisionInputs = {};
export type Canvas_Shape_DelayInputs = {};
export type Canvas_Shape_DiamondInputs = {};
export type Canvas_Shape_DocumentInputs = {};
export type Canvas_Shape_EllipseInputs = {};
export type Canvas_Shape_Group_ArrowsInputs = {};
export type Canvas_Shape_Group_BasicInputs = {};
export type Canvas_Shape_Group_FlowchartInputs = {};
export type Canvas_Shape_HeartInputs = {};
export type Canvas_Shape_HexagonInputs = {};
export type Canvas_Shape_Manual_InputInputs = {};
export type Canvas_Shape_OctagonInputs = {};
export type Canvas_Shape_Off_PageInputs = {};
export type Canvas_Shape_ParallelogramInputs = {};
export type Canvas_Shape_PentagonInputs = {};
export type Canvas_Shape_PlusInputs = {};
export type Canvas_Shape_PredefinedInputs = {};
export type Canvas_Shape_PreparationInputs = {};
export type Canvas_Shape_ProcessInputs = {};
export type Canvas_Shape_RectangleInputs = {};
export type Canvas_Shape_RingInputs = {};
export type Canvas_Shape_RoundedInputs = {};
export type Canvas_Shape_SpeechInputs = {};
export type Canvas_Shape_StarInputs = {};
export type Canvas_Shape_TerminatorInputs = {};
export type Canvas_Shape_TrapezoidInputs = {};
export type Canvas_Shape_TriangleInputs = {};
export type Canvas_Stage_FailedInputs = { why: NonNullable<unknown> };
export type Canvas_Stage_No_BackendInputs = {};
export type Canvas_Tool_ArrowInputs = {};
export type Canvas_Tool_CardInputs = {};
export type Canvas_Tool_FileInputs = {};
export type Canvas_Tool_File_TitleInputs = {};
export type Canvas_Tool_FrameInputs = {};
export type Canvas_Tool_IconsInputs = {};
export type Canvas_Tool_NoteInputs = {};
export type Canvas_Tool_ShapesInputs = {};
export type Canvas_Tool_TextInputs = {};
export type Canvas_Tool_With_KeyInputs = { label: NonNullable<unknown>, key: NonNullable<unknown> };
export type Canvas_Tools_GripInputs = {};
export type Canvas_Tools_LabelInputs = {};
export type Canvas_Tools_Undo_TitleInputs = {};
export type Canvas_Tools_UnstowInputs = {};
export type Canvas_UndoInputs = {};
export type Canvases_AllInputs = {};
export type Canvases_Ask_AllowInputs = {};
export type Canvases_Ask_An_AgentInputs = {};
export type Canvases_Ask_CreateInputs = { card: NonNullable<unknown>, name: NonNullable<unknown> };
export type Canvases_Ask_DenyInputs = {};
export type Canvases_Ask_QueueInputs = { card: NonNullable<unknown>, agent: NonNullable<unknown>, task: NonNullable<unknown> };
export type Canvases_Ask_SendInputs = { card: NonNullable<unknown>, agent: NonNullable<unknown>, task: NonNullable<unknown> };
export type Canvases_Ask_SomethingInputs = {};
export type Canvases_Ask_TitleInputs = {};
export type Canvases_AzInputs = {};
export type Canvases_CancelInputs = {};
export type Canvases_CanvasesInputs = {};
export type Canvases_Card_TitleInputs = { title: NonNullable<unknown>, meta: NonNullable<unknown> };
export type Canvases_Card_Title_HereInputs = { title: NonNullable<unknown>, meta: NonNullable<unknown> };
export type Canvases_Card_Title_NobodyInputs = { title: NonNullable<unknown>, meta: NonNullable<unknown> };
export type Canvases_CloseInputs = {};
export type Canvases_CopyInputs = {};
export type Canvases_Copy_LabelInputs = { title: NonNullable<unknown> };
export type Canvases_CreateInputs = {};
export type Canvases_CurrentInputs = {};
export type Canvases_DeleteInputs = {};
export type Canvases_Delete_CanvasInputs = {};
export type Canvases_Delete_LabelInputs = { title: NonNullable<unknown> };
export type Canvases_Delete_TitleInputs = {};
export type Canvases_EmptyInputs = {};
export type Canvases_FindInputs = {};
export type Canvases_Find_NoneInputs = {};
export type Canvases_Find_None_QueryInputs = { query: NonNullable<unknown> };
export type Canvases_Find_TitleInputs = {};
export type Canvases_KeepInputs = {};
export type Canvases_Meta_CardsInputs = { count: NonNullable<unknown>, shown: NonNullable<unknown> };
export type Canvases_Meta_EmptyInputs = {};
export type Canvases_Name_NewInputs = {};
export type Canvases_NewInputs = {};
export type Canvases_New_NameInputs = { title: NonNullable<unknown> };
export type Canvases_No_PictureInputs = {};
export type Canvases_OpenInputs = { title: NonNullable<unknown> };
export type Canvases_Ops_A_Note_A_Card_WordsInputs = {};
export type Canvases_Ops_A_PencilInputs = {};
export type Canvases_Ops_A_Rectangle_An_Ellipse_AInputs = {};
export type Canvases_Ops_Add_A_Photo_Or_AInputs = {};
export type Canvases_Ops_Always_The_Canvas_Even_WhileInputs = {};
export type Canvases_Ops_Cards_And_The_ConversationInputs = {};
export type Canvases_Ops_Changing_A_ComponentInputs = {};
export type Canvases_Ops_ClickInputs = {};
export type Canvases_Ops_Click_A_Turn_On_TheInputs = {};
export type Canvases_Ops_Commands_In_The_Input_BarInputs = {};
export type Canvases_Ops_Comment_On_Them_Kept_InInputs = {};
export type Canvases_Ops_Delete_ItInputs = {};
export type Canvases_Ops_Delete_The_Strokes_The_LassoInputs = {};
export type Canvases_Ops_Double_ClickInputs = {};
export type Canvases_Ops_DragInputs = {};
export type Canvases_Ops_Drag_A_Card_S_TitleInputs = {};
export type Canvases_Ops_Drag_A_Selected_ComponentInputs = {};
export type Canvases_Ops_Drag_Drag_The_CornerInputs = {};
export type Canvases_Ops_Drag_Inside_An_EmbedInputs = {};
export type Canvases_Ops_Draw_On_The_Card_PenInputs = {};
export type Canvases_Ops_DrawingInputs = {};
export type Canvases_Ops_Draws_With_Its_Pressure_AndInputs = {};
export type Canvases_Ops_Drop_A_File_On_AInputs = {};
export type Canvases_Ops_Duplicate_ItInputs = {};
export type Canvases_Ops_Embed_It_Where_It_LandedInputs = {};
export type Canvases_Ops_Every_Card_In_The_DeckInputs = {};
export type Canvases_Ops_Fit_Everything_On_The_CanvasInputs = {};
export type Canvases_Ops_Fit_The_Selected_CardInputs = {};
export type Canvases_Ops_FooterInputs = {};
export type Canvases_Ops_From_This_Device_In_TheInputs = {};
export type Canvases_Ops_Kind_Tone_Order_Duplicate_DeleteInputs = {};
export type Canvases_Ops_Let_The_Selection_GoInputs = {};
export type Canvases_Ops_Move_ItInputs = {};
export type Canvases_Ops_Move_It_Resize_ItInputs = {};
export type Canvases_Ops_Move_The_CardInputs = {};
export type Canvases_Ops_Moving_AroundInputs = {};
export type Canvases_Ops_NameInputs = {};
export type Canvases_Ops_Nudge_Nudge_By_TenInputs = {};
export type Canvases_Ops_Pan_From_Anywhere_Including_OverInputs = {};
export type Canvases_Ops_Pan_The_CanvasInputs = {};
export type Canvases_Ops_Pick_A_Tool_Then_TapInputs = {};
export type Canvases_Ops_PinchInputs = {};
export type Canvases_Ops_Pinch_WheelInputs = {};
export type Canvases_Ops_Place_A_Sticky_Card_TextInputs = {};
export type Canvases_Ops_Put_It_AwayInputs = {};
export type Canvases_Ops_Put_The_Pen_DownInputs = {};
export type Canvases_Ops_Reading_A_CardInputs = {};
export type Canvases_Ops_Retype_Its_Words_In_PlaceInputs = {};
export type Canvases_Ops_Scrolls_The_Embed_Not_TheInputs = {};
export type Canvases_Ops_Select_Drag_And_ResizeInputs = {};
export type Canvases_Ops_Select_ItInputs = {};
export type Canvases_Ops_Select_WordsInputs = {};
export type Canvases_Ops_Send_Behind_Bring_In_FrontInputs = {};
export type Canvases_Ops_Send_The_Line_To_ThatInputs = {};
export type Canvases_Ops_ShortcutsInputs = {};
export type Canvases_Ops_Space_DragInputs = {};
export type Canvases_Ops_Swipe_In_From_The_LeftInputs = {};
export type Canvases_Ops_Swipe_In_From_The_RightInputs = {};
export type Canvases_Ops_Swipe_The_Conversation_RightInputs = {};
export type Canvases_Ops_Take_It_Off_The_CanvasInputs = {};
export type Canvases_Ops_TapInputs = {};
export type Canvases_Ops_Tap_AgainInputs = {};
export type Canvases_Ops_The_Agents_The_Cards_TheyInputs = {};
export type Canvases_Ops_The_BrushInputs = {};
export type Canvases_Ops_The_Card_SInputs = {};
export type Canvases_Ops_The_Cards_And_Agents_RailInputs = {};
export type Canvases_Ops_The_ConversationInputs = {};
export type Canvases_Ops_The_Conversation_At_That_TurnInputs = {};
export type Canvases_Ops_The_Conversation_Opened_And_ClosedInputs = {};
export type Canvases_Ops_The_Grid_ButtonInputs = {};
export type Canvases_Ops_The_Panel_ButtonsInputs = {};
export type Canvases_Ops_The_Properties_SheetInputs = {};
export type Canvases_Ops_The_Same_Two_Panels_EitherInputs = {};
export type Canvases_Ops_The_Speech_Bubble_ButtonInputs = {};
export type Canvases_Ops_The_Two_Title_Bar_ButtonsInputs = {};
export type Canvases_Ops_Two_Finger_ScrollInputs = {};
export type Canvases_Ops_Two_FingersInputs = {};
export type Canvases_Ops_Undo_On_This_CardInputs = {};
export type Canvases_Ops_Undo_Redo_A_Stroke_WhileInputs = {};
export type Canvases_Ops_Zoom_About_The_CentreInputs = {};
export type Canvases_Ops_Zoom_About_The_FingersInputs = {};
export type Canvases_Ops_Zoom_About_The_PointerInputs = {};
export type Canvases_OrderInputs = {};
export type Canvases_RecentInputs = {};
export type Canvases_RenameInputs = {};
export type Canvases_Rename_LabelInputs = { title: NonNullable<unknown> };
export type Canvases_Shared_ByInputs = { owner: NonNullable<unknown> };
export type Canvases_Shared_By_ViewInputs = { owner: NonNullable<unknown> };
export type Chat_Alert_AskInputs = {};
export type Chat_Alert_Ask_NoteInputs = {};
export type Chat_Alert_DoneInputs = {};
export type Chat_Alert_Done_NoteInputs = {};
export type Chat_Alert_ProblemInputs = {};
export type Chat_Alert_Problem_NoteInputs = {};
export type Chat_Conversation_HistoryInputs = {};
export type Chat_Earlier_CountInputs = { count: NonNullable<unknown> };
export type Chat_Earlier_MessagesInputs = {};
export type Chat_EmptyInputs = {};
export type Chat_ForkInputs = {};
export type Chat_Fork_LabelInputs = {};
export type Chat_Fork_TitleInputs = {};
export type Chat_Hide_ConversationInputs = {};
export type Chat_Hide_ThinkingInputs = {};
export type Chat_Latest_MessagesInputs = {};
export type Chat_Pill_As_ShownInputs = {};
export type Chat_Pill_CloseInputs = {};
export type Chat_Pill_Exact_TextInputs = {};
export type Chat_Pill_Open_FileInputs = { name: NonNullable<unknown> };
export type Chat_Pill_RemoveInputs = {};
export type Chat_Pill_Show_On_CanvasInputs = { name: NonNullable<unknown> };
export type Chat_Pill_SubInputs = { source: NonNullable<unknown> };
export type Chat_Pill_Sub_NamedInputs = { name: NonNullable<unknown>, source: NonNullable<unknown> };
export type Chat_RewindInputs = {};
export type Chat_Rewind_LabelInputs = {};
export type Chat_Rewind_TitleInputs = {};
export type Chat_Running_ToolsInputs = {};
export type Chat_Scroll_LatestInputs = {};
export type Chat_Show_ConversationInputs = {};
export type Chat_Sound_SilentInputs = {};
export type Chat_State_StreamingInputs = {};
export type Chat_State_ThinkingInputs = {};
export type Chat_State_ToolInputs = {};
export type Chat_State_WaitingInputs = {};
export type Chat_The_ConversationInputs = {};
export type Chat_ThinkingInputs = {};
export type Chat_Tm_Fork_NoteInputs = {};
export type Chat_Tm_Go_BackInputs = {};
export type Chat_Tm_PreviewInputs = {};
export type Chat_Tm_Preview_NoteInputs = {};
export type Chat_Tm_RestoreInputs = {};
export type Chat_Tm_Restore_NoteInputs = {};
export type Chat_Tm_Rewind_NoteInputs = {};
export type Chat_Tm_Stop_PreviewingInputs = {};
export type Chat_Tm_TitleInputs = {};
export type Chat_TodayInputs = {};
export type Chat_Tool_First_CharactersInputs = { shown: NonNullable<unknown>, total: NonNullable<unknown> };
export type Chat_Tool_Group_DoneInputs = { count: NonNullable<unknown> };
export type Chat_Tool_Group_HideInputs = {};
export type Chat_Tool_Group_LabelInputs = { count: NonNullable<unknown>, names: NonNullable<unknown> };
export type Chat_Tool_Group_ShowInputs = {};
export type Chat_Tool_Group_ToolsInputs = { count: NonNullable<unknown> };
export type Chat_Tool_Hide_OutputInputs = {};
export type Chat_Tool_ImagesInputs = { count: NonNullable<unknown> };
export type Chat_Tool_Loading_RestInputs = {};
export type Chat_Tool_Show_OutputInputs = {};
export type Chat_TypingInputs = {};
export type Chat_Waiting_For_YouInputs = { name: NonNullable<unknown> };
export type Chat_WorkingInputs = {};
export type Chat_YesterdayInputs = {};
export type Claudelogin_ApiInputs = {};
export type Claudelogin_Api_SubInputs = {};
export type Claudelogin_CancelInputs = {};
export type Claudelogin_ChooseInputs = {};
export type Claudelogin_CloseInputs = {};
export type Claudelogin_Code_LabelInputs = {};
export type Claudelogin_Code_PlaceholderInputs = {};
export type Claudelogin_ContinueInputs = {};
export type Claudelogin_CopiedInputs = {};
export type Claudelogin_CopyInputs = {};
export type Claudelogin_DoneInputs = {};
export type Claudelogin_Done_BodyInputs = {};
export type Claudelogin_FailedInputs = {};
export type Claudelogin_FinishInputs = {};
export type Claudelogin_FinishingInputs = {};
export type Claudelogin_Link_LabelInputs = {};
export type Claudelogin_Link_LeadInputs = {};
export type Claudelogin_No_AccountInputs = {};
export type Claudelogin_No_Account_NamedInputs = { agent: NonNullable<unknown> };
export type Claudelogin_OpenInputs = {};
export type Claudelogin_Signed_InInputs = {};
export type Claudelogin_Signed_In_AsInputs = { email: NonNullable<unknown> };
export type Claudelogin_StartingInputs = {};
export type Claudelogin_SubscriptionInputs = {};
export type Claudelogin_Subscription_SubInputs = {};
export type Claudelogin_TitleInputs = {};
export type Claudelogin_Try_AgainInputs = {};
export type Composer_AttachInputs = {};
export type Composer_Context_DialInputs = { percent: NonNullable<unknown> };
export type Composer_Context_LabelInputs = {};
export type Composer_Context_SessionInputs = {};
export type Composer_Context_UsageInputs = {};
export type Composer_Context_UsedInputs = {};
export type Composer_Context_WindowInputs = {};
export type Composer_Field_LabelInputs = {};
export type Composer_Hint_ChooseInputs = { key: NonNullable<unknown> };
export type Composer_Hint_CommandsInputs = { key: NonNullable<unknown> };
export type Composer_Hint_CompleteInputs = { key: NonNullable<unknown> };
export type Composer_Hint_DismissInputs = { key: NonNullable<unknown> };
export type Composer_Hint_MentionInputs = { key: NonNullable<unknown> };
export type Composer_Hint_NewlineInputs = { key: NonNullable<unknown> };
export type Composer_Hint_QueueInputs = { key: NonNullable<unknown> };
export type Composer_Hint_SendInputs = { key: NonNullable<unknown> };
export type Composer_Hint_SteerInputs = { key: NonNullable<unknown> };
export type Composer_ListeningInputs = {};
export type Composer_Mention_LabelInputs = {};
export type Composer_Mic_BusyInputs = {};
export type Composer_Mic_FailedInputs = {};
export type Composer_Mic_Failed_NamedInputs = { name: NonNullable<unknown> };
export type Composer_Mic_HttpsInputs = {};
export type Composer_Mic_No_Browser_MicInputs = {};
export type Composer_Mic_None_HereInputs = {};
export type Composer_Mic_Not_ConnectedInputs = {};
export type Composer_Mic_Site_OffInputs = {};
export type Composer_Mic_SpeakInputs = {};
export type Composer_Mic_SystemInputs = {};
export type Composer_Mic_TitleInputs = {};
export type Composer_Mic_TranscribingInputs = {};
export type Composer_Mode_AskInputs = {};
export type Composer_Mode_Ask_NoteInputs = {};
export type Composer_Mode_AutoInputs = {};
export type Composer_Mode_Auto_NoteInputs = {};
export type Composer_Mode_EditInputs = {};
export type Composer_Mode_Edit_NoteInputs = {};
export type Composer_Mode_LabelInputs = {};
export type Composer_Mode_PlanInputs = {};
export type Composer_Mode_Plan_NoteInputs = {};
export type Composer_Model_AccountInputs = {};
export type Composer_Model_DefaultInputs = {};
export type Composer_Model_FindInputs = {};
export type Composer_Model_LabelInputs = {};
export type Composer_Model_No_CredentialsInputs = {};
export type Composer_Model_NoneInputs = {};
export type Composer_Model_SearchInputs = {};
export type Composer_Model_Signed_OutInputs = {};
export type Composer_Model_ThinkingInputs = {};
export type Composer_Pill_CanvasInputs = {};
export type Composer_Pill_Canvas_InInputs = { component: NonNullable<unknown> };
export type Composer_Pill_Canvas_OnInputs = { name: NonNullable<unknown> };
export type Composer_Pill_CardInputs = { path: NonNullable<unknown> };
export type Composer_Pill_FileInputs = { path: NonNullable<unknown> };
export type Composer_Pill_ItemInputs = {};
export type Composer_Pill_YoursInputs = {};
export type Composer_Pill_Yours_InInputs = { component: NonNullable<unknown> };
export type Composer_Pill_Yours_OnInputs = { name: NonNullable<unknown> };
export type Composer_Placeholder_AskInputs = { name: NonNullable<unknown> };
export type Composer_Placeholder_SteerInputs = { name: NonNullable<unknown> };
export type Composer_Queue_EditInputs = {};
export type Composer_Queue_Edit_TitleInputs = {};
export type Composer_Queue_FoldInputs = {};
export type Composer_Queue_HeldInputs = {};
export type Composer_Queue_LabelInputs = {};
export type Composer_Queue_NextInputs = { text: NonNullable<unknown> };
export type Composer_Queue_One_Per_TurnInputs = {};
export type Composer_Queue_Release_AllInputs = {};
export type Composer_Queue_Release_HeldInputs = {};
export type Composer_Queue_RemoveInputs = {};
export type Composer_Queue_Send_AllInputs = {};
export type Composer_Queue_Send_NowInputs = {};
export type Composer_Queue_Send_Now_TitleInputs = {};
export type Composer_Queue_ShowInputs = {};
export type Composer_Queue_TitleInputs = { count: NonNullable<unknown>, name: NonNullable<unknown> };
export type Composer_Recipient_BoardInputs = {};
export type Composer_Recipient_ChipInputs = { label: NonNullable<unknown> };
export type Composer_Recipient_LabelInputs = {};
export type Composer_Recipient_NoneInputs = {};
export type Composer_Recipient_ToInputs = {};
export type Composer_RecordingInputs = {};
export type Composer_Recording_DiscardInputs = {};
export type Composer_Recording_Discard_TitleInputs = {};
export type Composer_Recording_DoneInputs = {};
export type Composer_Recording_Done_TitleInputs = {};
export type Composer_SendInputs = {};
export type Composer_Slash_ExtInputs = {};
export type Composer_Slash_LabelInputs = {};
export type Composer_Slash_PromptInputs = {};
export type Composer_Slash_SkillInputs = {};
export type Composer_SteerInputs = {};
export type Composer_StopInputs = {};
export type Composer_Stt_Browser_StoppedInputs = { reason: NonNullable<unknown> };
export type Composer_Stt_No_BrowserInputs = {};
export type Composer_Stt_No_EitherInputs = {};
export type Composer_Stt_No_ServerInputs = {};
export type Composer_Stt_Server_FailedInputs = { status: NonNullable<unknown> };
export type Composer_The_AgentInputs = {};
export type Composer_Thinking_HighInputs = {};
export type Composer_Thinking_LowInputs = {};
export type Composer_Thinking_MaxInputs = {};
export type Composer_Thinking_MediumInputs = {};
export type Composer_Thinking_MinimalInputs = {};
export type Composer_Thinking_OffInputs = {};
export type Composer_Thinking_XhighInputs = {};
export type Composer_Voice_AutoInputs = {};
export type Composer_Voice_Auto_NoteInputs = {};
export type Composer_Voice_BrowserInputs = {};
export type Composer_Voice_Browser_NoteInputs = {};
export type Composer_Voice_Lang_BrowserInputs = {};
export type Composer_Voice_ServerInputs = {};
export type Composer_Voice_Server_NoteInputs = {};
export type Connections_AddressInputs = {};
export type Connections_BackInputs = {};
export type Connections_CodeInputs = {};
export type Connections_Code_HintInputs = {};
export type Connections_Code_PlaceholderInputs = {};
export type Connections_ConnectInputs = {};
export type Connections_Connect_ServerInputs = {};
export type Connections_ConnectingInputs = {};
export type Connections_DownloadInputs = {};
export type Connections_File_CardsInputs = { count: NonNullable<unknown> };
export type Connections_File_Needs_HttpsInputs = {};
export type Connections_Files_GoneInputs = {};
export type Connections_Forget_LabelInputs = { name: NonNullable<unknown> };
export type Connections_Forget_ServerInputs = {};
export type Connections_LabelInputs = {};
export type Connections_NameInputs = {};
export type Connections_Name_PlaceholderInputs = {};
export type Connections_Newer_FormatInputs = { format: NonNullable<unknown> };
export type Connections_No_ManifestInputs = {};
export type Connections_No_RelayInputs = { status: NonNullable<unknown> };
export type Connections_Not_AddressInputs = {};
export type Connections_Not_ReachableInputs = {};
export type Connections_Not_ZipInputs = {};
export type Connections_Open_FileInputs = {};
export type Connections_OptionalInputs = {};
export type Connections_Other_DecksInputs = {};
export type Connections_Pairing_RevokedInputs = {};
export type Connections_Read_OnlyInputs = {};
export type Connections_Read_Only_RefusalInputs = {};
export type Connections_Remove_BundleInputs = {};
export type Connections_RenameInputs = {};
export type Connections_Rename_LabelInputs = { name: NonNullable<unknown> };
export type Connections_Server_AnsweredInputs = { status: NonNullable<unknown> };
export type Connections_Start_ForgottenInputs = {};
export type Connections_Start_PublicInputs = {};
export type Connections_Start_SwitcherInputs = {};
export type Connections_Switch_TitleInputs = {};
export type Connections_This_ServerInputs = {};
export type Connections_UnreachableInputs = { base: NonNullable<unknown> };
export type Connections_Worker_Needs_HttpsInputs = {};
export type Connections_Zip_DamagedInputs = {};
export type Docs_AcceptInputs = {};
export type Docs_Accept_AllInputs = {};
export type Docs_Accept_All_TitleInputs = {};
export type Docs_Another_ProgramInputs = {};
export type Docs_Back_To_NowInputs = {};
export type Docs_CancelInputs = {};
export type Docs_ChangesInputs = {};
export type Docs_Changes_TitleInputs = {};
export type Docs_CloseInputs = {};
export type Docs_Close_PdfInputs = {};
export type Docs_CommentInputs = {};
export type Docs_CommentsInputs = {};
export type Docs_Comments_TitleInputs = {};
export type Docs_DoneInputs = {};
export type Docs_Drag_ResizeInputs = {};
export type Docs_Earlier_VersionInputs = {};
export type Docs_EditedInputs = {};
export type Docs_Edited_ByInputs = { who: NonNullable<unknown>, time: NonNullable<unknown> };
export type Docs_Edited_OutsideInputs = { time: NonNullable<unknown> };
export type Docs_EmptyInputs = {};
export type Docs_Empty_ClickInputs = {};
export type Docs_ErrorsInputs = { count: NonNullable<unknown> };
export type Docs_First_TypesetInputs = {};
export type Docs_Git_AheadInputs = { count: NonNullable<unknown> };
export type Docs_Git_BehindInputs = { count: NonNullable<unknown> };
export type Docs_Git_Button_TitleInputs = { branch: NonNullable<unknown> };
export type Docs_Git_ChangedInputs = { count: NonNullable<unknown> };
export type Docs_Git_DoneInputs = {};
export type Docs_Git_In_StepInputs = { name: NonNullable<unknown> };
export type Docs_Git_No_RemoteInputs = {};
export type Docs_Git_Not_PushedInputs = {};
export type Docs_Git_NoteInputs = {};
export type Docs_Git_PullInputs = {};
export type Docs_Git_Pull_TitleInputs = { name: NonNullable<unknown> };
export type Docs_Git_PullingInputs = {};
export type Docs_Git_PushInputs = {};
export type Docs_Git_Push_TitleInputs = { name: NonNullable<unknown> };
export type Docs_Git_PushingInputs = {};
export type Docs_Git_StateInputs = { parts: NonNullable<unknown> };
export type Docs_Git_StoppedInputs = {};
export type Docs_Git_TitleInputs = {};
export type Docs_Go_To_LineInputs = {};
export type Docs_Google_Doc_NamedInputs = { title: NonNullable<unknown> };
export type Docs_Google_ErrorInputs = {};
export type Docs_Google_FailedInputs = {};
export type Docs_Google_FakeInputs = {};
export type Docs_Google_In_StepInputs = {};
export type Docs_Google_In_Step_SinceInputs = { time: NonNullable<unknown> };
export type Docs_Google_OpenInputs = {};
export type Docs_Google_PasteInputs = {};
export type Docs_Google_Paste_LabelInputs = {};
export type Docs_Google_SendingInputs = {};
export type Docs_Google_Sign_InInputs = {};
export type Docs_Google_Signed_InInputs = { email: NonNullable<unknown> };
export type Docs_Google_Signed_In_AsInputs = { email: NonNullable<unknown> };
export type Docs_Google_SigninInputs = {};
export type Docs_Google_SyncingInputs = {};
export type Docs_Google_TitleInputs = {};
export type Docs_HistoryInputs = {};
export type Docs_History_TitleInputs = {};
export type Docs_Katex_UnknownInputs = { command: NonNullable<unknown> };
export type Docs_Latex_StoppedInputs = {};
export type Docs_LineInputs = { line: NonNullable<unknown> };
export type Docs_Link_PromptInputs = {};
export type Docs_Md_Front_MatterInputs = {};
export type Docs_No_CommentsInputs = {};
export type Docs_No_VersionsInputs = {};
export type Docs_Not_DrawnInputs = {};
export type Docs_Not_Drawn_BecauseInputs = { reason: NonNullable<unknown> };
export type Docs_Not_TypesetInputs = {};
export type Docs_Nothing_To_ReviewInputs = {};
export type Docs_Open_PdfInputs = {};
export type Docs_OpeningInputs = {};
export type Docs_Paragraph_StyleInputs = {};
export type Docs_Pdf_Not_YetInputs = {};
export type Docs_Pdf_TitleInputs = {};
export type Docs_Pdf_UnreadableInputs = {};
export type Docs_Read_OnlyInputs = {};
export type Docs_ReadingInputs = {};
export type Docs_RejectInputs = {};
export type Docs_Reject_AllInputs = {};
export type Docs_Reject_All_TitleInputs = {};
export type Docs_ReplyInputs = {};
export type Docs_ResolveInputs = {};
export type Docs_RestoreInputs = {};
export type Docs_Restore_VersionInputs = {};
export type Docs_SavedInputs = {};
export type Docs_SavingInputs = {};
export type Docs_Show_VersionInputs = {};
export type Docs_SomeoneInputs = {};
export type Docs_SourceInputs = {};
export type Docs_Source_TitleInputs = {};
export type Docs_Start_WritingInputs = {};
export type Docs_Style_BodyInputs = {};
export type Docs_Style_Body_TextInputs = {};
export type Docs_Style_HeadingInputs = { level: NonNullable<unknown> };
export type Docs_Style_NormalInputs = {};
export type Docs_Style_Paragraph_HeadingInputs = {};
export type Docs_Style_SectionInputs = {};
export type Docs_Style_SubsectionInputs = {};
export type Docs_Style_SubsubsectionInputs = {};
export type Docs_Style_SubtitleInputs = {};
export type Docs_Style_TitleInputs = {};
export type Docs_Tex_No_TitleInputs = {};
export type Docs_Tex_PreambleInputs = { count: NonNullable<unknown> };
export type Docs_Tool_Align_CentreInputs = {};
export type Docs_Tool_Align_LeftInputs = {};
export type Docs_Tool_Align_RightInputs = {};
export type Docs_Tool_BiggerInputs = {};
export type Docs_Tool_BoldInputs = { key: NonNullable<unknown> };
export type Docs_Tool_BulletsInputs = { key: NonNullable<unknown> };
export type Docs_Tool_ClearInputs = { key: NonNullable<unknown> };
export type Docs_Tool_CodeInputs = { key: NonNullable<unknown> };
export type Docs_Tool_CodeblockInputs = {};
export type Docs_Tool_Col_LeftInputs = {};
export type Docs_Tool_Col_RightInputs = {};
export type Docs_Tool_CommentInputs = {};
export type Docs_Tool_Delete_ColInputs = {};
export type Docs_Tool_Delete_RowInputs = {};
export type Docs_Tool_EquationInputs = {};
export type Docs_Tool_FontInputs = {};
export type Docs_Tool_Font_SizeInputs = {};
export type Docs_Tool_HighlightInputs = { key: NonNullable<unknown> };
export type Docs_Tool_Highlight_ColourInputs = {};
export type Docs_Tool_IndentInputs = { key: NonNullable<unknown> };
export type Docs_Tool_Insert_TableInputs = {};
export type Docs_Tool_ItalicInputs = { key: NonNullable<unknown> };
export type Docs_Tool_JustifyInputs = {};
export type Docs_Tool_LinkInputs = { key: NonNullable<unknown> };
export type Docs_Tool_MathInputs = { key: NonNullable<unknown> };
export type Docs_Tool_NumberedInputs = {};
export type Docs_Tool_NumbersInputs = { key: NonNullable<unknown> };
export type Docs_Tool_OutdentInputs = { key: NonNullable<unknown> };
export type Docs_Tool_QuoteInputs = {};
export type Docs_Tool_RedoInputs = { key: NonNullable<unknown> };
export type Docs_Tool_Row_AboveInputs = {};
export type Docs_Tool_Row_BelowInputs = {};
export type Docs_Tool_RuleInputs = {};
export type Docs_Tool_SmallerInputs = {};
export type Docs_Tool_StrikeInputs = { key: NonNullable<unknown> };
export type Docs_Tool_TableInputs = {};
export type Docs_Tool_TasksInputs = {};
export type Docs_Tool_Text_ColourInputs = {};
export type Docs_Tool_UnderlineInputs = { key: NonNullable<unknown> };
export type Docs_Tool_UndoInputs = { key: NonNullable<unknown> };
export type Docs_TypesetInputs = {};
export type Docs_Typeset_AgainInputs = {};
export type Docs_Typeset_ErrorsInputs = {};
export type Docs_Typeset_WhenInputs = { time: NonNullable<unknown>, seconds: NonNullable<unknown> };
export type Docs_TypesettingInputs = {};
export type Docs_Word_FailedInputs = { message: NonNullable<unknown> };
export type Docs_Word_PreambleInputs = { count: NonNullable<unknown> };
export type Files_AddedInputs = { name: NonNullable<unknown> };
export type Files_Added_ReusedInputs = { name: NonNullable<unknown> };
export type Files_AddingInputs = {};
export type Files_Adding_Card_ManyInputs = { count: NonNullable<unknown> };
export type Files_Adding_Card_OneInputs = { name: NonNullable<unknown> };
export type Files_Adding_ManyInputs = { count: NonNullable<unknown> };
export type Files_Adding_OneInputs = { name: NonNullable<unknown> };
export type Files_All_PlacesInputs = {};
export type Files_AskingInputs = {};
export type Files_Attach_SubInputs = {};
export type Files_Attach_TitleInputs = {};
export type Files_CancelInputs = {};
export type Files_CancelledInputs = {};
export type Files_Canvas_SubInputs = {};
export type Files_Canvas_TitleInputs = {};
export type Files_CloseInputs = {};
export type Files_Close_TitleInputs = {};
export type Files_Connection_DroppedInputs = {};
export type Files_CountInputs = { count: NonNullable<unknown> };
export type Files_Did_Not_WorkInputs = {};
export type Files_Docs_SearchInputs = {};
export type Files_Docs_Search_LabelInputs = {};
export type Files_DoneInputs = {};
export type Files_Embed_SubInputs = {};
export type Files_Embed_TitleInputs = {};
export type Files_EmptyInputs = {};
export type Files_FailedInputs = { name: NonNullable<unknown>, error: NonNullable<unknown> };
export type Files_FakeInputs = {};
export type Files_FilterInputs = {};
export type Files_Filter_LabelInputs = {};
export type Files_Google_AnsweredInputs = { status: NonNullable<unknown> };
export type Files_Is_EmptyInputs = { name: NonNullable<unknown> };
export type Files_Kind_ArchiveInputs = {};
export type Files_Kind_AudioInputs = {};
export type Files_Kind_FileInputs = {};
export type Files_Kind_FolderInputs = {};
export type Files_Kind_ImageInputs = {};
export type Files_Kind_PresentationInputs = {};
export type Files_Kind_SpreadsheetInputs = {};
export type Files_Kind_TableInputs = {};
export type Files_Kind_TextInputs = {};
export type Files_Kind_VideoInputs = {};
export type Files_Kind_Web_PageInputs = {};
export type Files_ListInputs = {};
export type Files_No_Doc_MatchInputs = { query: NonNullable<unknown> };
export type Files_No_DocsInputs = {};
export type Files_No_MatchInputs = { filter: NonNullable<unknown> };
export type Files_Not_JsonInputs = {};
export type Files_Not_Set_UpInputs = {};
export type Files_Not_Set_Up_NoteInputs = {};
export type Files_Not_UploadedInputs = {};
export type Files_Open_LinkInputs = {};
export type Files_Paste_AddressInputs = {};
export type Files_Paste_Address_LabelInputs = {};
export type Files_Path_TitleInputs = {};
export type Files_ProgressInputs = { name: NonNullable<unknown>, percent: NonNullable<unknown>, size: NonNullable<unknown> };
export type Files_Progress_ColonInputs = { name: NonNullable<unknown>, percent: NonNullable<unknown>, size: NonNullable<unknown> };
export type Files_Progress_NthInputs = { index: NonNullable<unknown>, total: NonNullable<unknown>, name: NonNullable<unknown>, percent: NonNullable<unknown>, size: NonNullable<unknown> };
export type Files_Put_Canvas_ManyInputs = { count: NonNullable<unknown> };
export type Files_Put_Canvas_OneInputs = { name: NonNullable<unknown> };
export type Files_Put_Card_ManyInputs = { count: NonNullable<unknown> };
export type Files_Put_Card_OneInputs = { name: NonNullable<unknown> };
export type Files_Read_Only_BundleInputs = {};
export type Files_Shared_ByInputs = { owner: NonNullable<unknown> };
export type Files_Signed_InInputs = {};
export type Files_Signed_In_AsInputs = { email: NonNullable<unknown> };
export type Files_Signed_In_SentenceInputs = { email: NonNullable<unknown> };
export type Files_Signin_AgainInputs = {};
export type Files_Signin_GoogleInputs = {};
export type Files_Signin_NoteInputs = {};
export type Files_Signin_TitleInputs = {};
export type Files_StaleInputs = {};
export type Files_Tab_FilesInputs = {};
export type Files_Tab_GoogleInputs = {};
export type Files_Timeline_PreviewInputs = {};
export type Files_Too_LargeInputs = { name: NonNullable<unknown>, size: NonNullable<unknown> };
export type Files_Typing_ReachesInputs = {};
export type Files_UnreadableInputs = { name: NonNullable<unknown>, status: NonNullable<unknown> };
export type Files_UpInputs = {};
export type Files_UploadInputs = {};
export type Files_Upload_Ask_BodyInputs = { size: NonNullable<unknown> };
export type Files_Upload_Ask_TitleInputs = { name: NonNullable<unknown> };
export type Files_Upload_FailedInputs = { status: NonNullable<unknown> };
export type Files_Upload_TitleInputs = {};
export type Files_Upload_YesInputs = {};
export type Files_View_OnlyInputs = { canvas: NonNullable<unknown>, owner: NonNullable<unknown> };
export type Files_View_Only_OwnerInputs = { canvas: NonNullable<unknown> };
export type Files_WhereInputs = {};
export type Frame_Bring_Tools_BackInputs = {};
export type Frame_Bring_Tray_BackInputs = {};
export type Frame_Color_BlueInputs = {};
export type Frame_Color_GreenInputs = {};
export type Frame_Color_InkInputs = {};
export type Frame_Color_Ink_LabelInputs = {};
export type Frame_Color_RedInputs = {};
export type Frame_Color_YellowInputs = {};
export type Frame_ColourInputs = {};
export type Frame_Delete_Selected_StrokesInputs = {};
export type Frame_Delete_StrokesInputs = {};
export type Frame_EraserInputs = {};
export type Frame_Eraser_LabelInputs = {};
export type Frame_FitInputs = {};
export type Frame_Fit_LabelInputs = {};
export type Frame_InstrumentInputs = {};
export type Frame_LassoInputs = {};
export type Frame_Lasso_LabelInputs = {};
export type Frame_MarkerInputs = {};
export type Frame_Marker_LabelInputs = {};
export type Frame_Offer_CanvasInputs = {};
export type Frame_Offer_CardInputs = {};
export type Frame_Offer_GoInputs = {};
export type Frame_Offer_StayInputs = {};
export type Frame_Offer_Stay_HereInputs = {};
export type Frame_Offer_ViewInputs = {};
export type Frame_PenInputs = {};
export type Frame_Pen_LabelInputs = {};
export type Frame_Pen_TrayInputs = {};
export type Frame_RedoInputs = {};
export type Frame_Tool_AppInputs = {};
export type Frame_Tool_ArrowInputs = {};
export type Frame_Tool_CardInputs = {};
export type Frame_Tool_CurvedInputs = {};
export type Frame_Tool_DiamondInputs = {};
export type Frame_Tool_ElbowInputs = {};
export type Frame_Tool_EllipseInputs = {};
export type Frame_Tool_FileInputs = {};
export type Frame_Tool_FrameInputs = {};
export type Frame_Tool_HandInputs = {};
export type Frame_Tool_HighlightInputs = {};
export type Frame_Tool_IconsInputs = {};
export type Frame_Tool_LineInputs = {};
export type Frame_Tool_LinkInputs = {};
export type Frame_Tool_Markdown_CardInputs = {};
export type Frame_Tool_More_ShapesInputs = {};
export type Frame_Tool_NoteInputs = {};
export type Frame_Tool_RectangleInputs = {};
export type Frame_Tool_SelectInputs = {};
export type Frame_Tool_ShapeInputs = {};
export type Frame_Tool_StarInputs = {};
export type Frame_Tool_TextInputs = {};
export type Frame_Tool_TriangleInputs = {};
export type Frame_Tool_ViewInputs = {};
export type Frame_ToolsInputs = {};
export type Frame_Tools_GripInputs = {};
export type Frame_Tray_GripInputs = {};
export type Frame_UndoInputs = {};
export type Frame_WidthInputs = {};
export type Frame_Width_PixelsInputs = { px: NonNullable<unknown> };
export type Frame_Width_PxInputs = { px: NonNullable<unknown> };
export type Frame_ZoomInputs = {};
export type Frame_Zoom_AtInputs = { percent: NonNullable<unknown> };
export type Frame_Zoom_InInputs = {};
export type Frame_Zoom_OutInputs = {};
export type Login_ApproveInputs = {};
export type Login_Approve_CodeInputs = { code: NonNullable<unknown> };
export type Login_Approve_FirstInputs = {};
export type Login_Approve_SubInputs = {};
export type Login_Approve_TitleInputs = { label: NonNullable<unknown> };
export type Login_Approve_Title_PlainInputs = {};
export type Login_ApprovedInputs = {};
export type Login_CancelInputs = {};
export type Login_CancelledInputs = {};
export type Login_Code_UnknownInputs = {};
export type Login_Document_TitleInputs = {};
export type Login_FailedInputs = { why: NonNullable<unknown> };
export type Login_No_PasswordInputs = {};
export type Login_Open_DecksInputs = {};
export type Login_Password_LabelInputs = {};
export type Login_SubInputs = {};
export type Login_SubmitInputs = {};
export type Login_UnreachableInputs = {};
export type Login_WaitInputs = { count: NonNullable<unknown> };
export type Login_WrongInputs = {};
export type Markup_CloseInputs = {};
export type Markup_Close_TitleInputs = {};
export type Markup_CommentInputs = {};
export type Markup_Comment_LabelInputs = {};
export type Markup_Comment_PlaceholderInputs = {};
export type Markup_KeepInputs = {};
export type Markup_Keep_TitleInputs = {};
export type Markup_Pick_AgentInputs = {};
export type Markup_SendInputs = {};
export type Markup_Send_TitleInputs = {};
export type Markup_Whole_CardInputs = {};
export type Markup_Whole_Card_TitledInputs = { title: NonNullable<unknown> };
export type Panel_Add_Agent_InInputs = { name: NonNullable<unknown> };
export type Panel_Add_Agent_NoneInputs = {};
export type Panel_App_AsleepInputs = {};
export type Panel_App_BrokenInputs = {};
export type Panel_App_BuildingInputs = {};
export type Panel_App_Dblclick_RunInputs = { title: NonNullable<unknown> };
export type Panel_App_Dblclick_ShowInputs = { title: NonNullable<unknown> };
export type Panel_App_InstallingInputs = {};
export type Panel_App_LogsInputs = {};
export type Panel_App_Logs_CloseInputs = {};
export type Panel_App_Logs_OfInputs = { title: NonNullable<unknown> };
export type Panel_App_MenuInputs = { title: NonNullable<unknown> };
export type Panel_App_MoreInputs = { title: NonNullable<unknown> };
export type Panel_App_No_MatchInputs = { query: NonNullable<unknown> };
export type Panel_App_RestartInputs = {};
export type Panel_App_RunningInputs = {};
export type Panel_App_StartInputs = {};
export type Panel_App_StartingInputs = {};
export type Panel_App_StopInputs = {};
export type Panel_App_StoppedInputs = {};
export type Panel_App_StoppingInputs = {};
export type Panel_Apps_LookingInputs = {};
export type Panel_Apps_NoneInputs = {};
export type Panel_ArrowsInputs = {};
export type Panel_Canvas_EmptyInputs = {};
export type Panel_Canvas_No_MatchInputs = { query: NonNullable<unknown> };
export type Panel_CardsInputs = {};
export type Panel_Clear_SearchInputs = {};
export type Panel_Delete_EllipsisInputs = {};
export type Panel_DrawingInputs = {};
export type Panel_Folder_FoldInputs = { name: NonNullable<unknown> };
export type Panel_Folder_ShowInputs = { name: NonNullable<unknown> };
export type Panel_HideInputs = {};
export type Panel_New_AgentInputs = {};
export type Panel_No_Agent_MatchesInputs = { query: NonNullable<unknown> };
export type Panel_No_AgentsInputs = {};
export type Panel_No_Agents_StartInputs = {};
export type Panel_Nothing_YetInputs = {};
export type Panel_Open_New_TabInputs = {};
export type Panel_PanelInputs = {};
export type Panel_ReadingInputs = {};
export type Panel_ReloadInputs = {};
export type Panel_Resize_TitleInputs = {};
export type Panel_Search_AgentsInputs = {};
export type Panel_Search_AppsInputs = {};
export type Panel_Search_CanvasInputs = {};
export type Panel_Search_NamedInputs = { name: NonNullable<unknown> };
export type Panel_Section_CanvasInputs = {};
export type Panel_Section_DeckInputs = {};
export type Panel_Section_HeldInputs = {};
export type Panel_SettingsInputs = {};
export type Panel_Show_On_CanvasInputs = {};
export type Panel_Side_PanelInputs = {};
export type Panel_Sidebar_WidthInputs = {};
export type Panel_Tab_AgentsInputs = {};
export type Panel_Tab_AppsInputs = {};
export type Panel_Tab_CanvasInputs = {};
export type Panel_Tab_RecentInputs = {};
export type Perf_Key_120Inputs = {};
export type Perf_Key_60Inputs = {};
export type Perf_Plot_LabelInputs = {};
export type Perf_SummaryInputs = { worst: NonNullable<unknown>, missed: NonNullable<unknown> };
export type Settings_Alert_AllowInputs = {};
export type Settings_Alert_BannerInputs = {};
export type Settings_Alert_Banner_AskInputs = {};
export type Settings_Alert_Banner_DoneInputs = {};
export type Settings_Alert_Banner_ProblemInputs = {};
export type Settings_Alert_DeniedInputs = {};
export type Settings_Alert_InsecureInputs = {};
export type Settings_Alert_Not_AskedInputs = {};
export type Settings_Alert_SilentInputs = {};
export type Settings_Alert_SoundInputs = {};
export type Settings_Alert_Sound_AskInputs = {};
export type Settings_Alert_Sound_DoneInputs = {};
export type Settings_Alert_Sound_ProblemInputs = {};
export type Settings_Alert_UnsupportedInputs = {};
export type Settings_Alert_VolumeInputs = {};
export type Settings_Alert_Volume_LoudInputs = {};
export type Settings_Alert_Volume_MediumInputs = {};
export type Settings_Alert_Volume_OffInputs = {};
export type Settings_Alert_Volume_Off_SubInputs = {};
export type Settings_Alert_Volume_QuietInputs = {};
export type Settings_Alert_WhenInputs = {};
export type Settings_CanvasInputs = {};
export type Settings_Chrome_AddressInputs = {};
export type Settings_Chrome_ExtensionInputs = {};
export type Settings_Chrome_New_CodeInputs = {};
export type Settings_Chrome_New_Code_TitleInputs = {};
export type Settings_Chrome_Not_PairedInputs = {};
export type Settings_Chrome_PairedInputs = {};
export type Settings_Chrome_SharingInputs = { count: NonNullable<unknown> };
export type Settings_Chrome_StopInputs = {};
export type Settings_Chrome_To_PairInputs = {};
export type Settings_Chrome_UntitledInputs = {};
export type Settings_Chrome_WaitingInputs = {};
export type Settings_Chrome_YoursInputs = {};
export type Settings_Claude_AddInputs = {};
export type Settings_Claude_DefaultInputs = {};
export type Settings_Claude_FootInputs = {};
export type Settings_Claude_No_NameInputs = {};
export type Settings_Claude_Own_LoginInputs = {};
export type Settings_Claude_RemoveInputs = {};
export type Settings_Claude_Remove_TitleInputs = { name: NonNullable<unknown> };
export type Settings_Claude_Signed_OutInputs = {};
export type Settings_Claude_SubscriptionsInputs = {};
export type Settings_Claude_UsedInputs = { percent: NonNullable<unknown> };
export type Settings_CloseInputs = {};
export type Settings_Conn_AddressInputs = {};
export type Settings_Conn_CodeInputs = {};
export type Settings_Conn_Code_SubInputs = {};
export type Settings_Conn_ConnectedInputs = {};
export type Settings_Conn_FootInputs = {};
export type Settings_Conn_GroupInputs = {};
export type Settings_Conn_NoneInputs = {};
export type Settings_Conn_RevokeInputs = {};
export type Settings_Conn_Revoke_AllInputs = {};
export type Settings_Conn_Revoke_TitleInputs = {};
export type Settings_Conn_SessionsInputs = { count: NonNullable<unknown> };
export type Settings_Conn_Unknown_SiteInputs = {};
export type Settings_Conn_UsedInputs = { site: NonNullable<unknown>, ago: NonNullable<unknown> };
export type Settings_CopiedInputs = {};
export type Settings_CopyInputs = {};
export type Settings_DoneInputs = {};
export type Settings_Five_Hour_TitleInputs = { ago: NonNullable<unknown> };
export type Settings_Five_Hour_Title_AgainInputs = { time: NonNullable<unknown>, ago: NonNullable<unknown> };
export type Settings_Five_Hour_UsedInputs = { percent: NonNullable<unknown> };
export type Settings_FpsInputs = {};
export type Settings_Fps_ShowInputs = {};
export type Settings_Fps_SubInputs = {};
export type Settings_LanguageInputs = {};
export type Settings_Language_BrowserInputs = { name: NonNullable<unknown> };
export type Settings_Language_RowInputs = {};
export type Settings_Language_SubInputs = {};
export type Settings_Password_ChangeInputs = {};
export type Settings_Password_Change_ButtonInputs = {};
export type Settings_Password_Change_SubInputs = {};
export type Settings_Password_ChangedInputs = {};
export type Settings_Password_CurrentInputs = {};
export type Settings_Password_EverywhereInputs = {};
export type Settings_Password_Everywhere_ButtonInputs = {};
export type Settings_Password_Everywhere_Confirm_BodyInputs = {};
export type Settings_Password_Everywhere_Confirm_NoInputs = {};
export type Settings_Password_Everywhere_Confirm_TitleInputs = {};
export type Settings_Password_Everywhere_Confirm_YesInputs = {};
export type Settings_Password_Everywhere_SubInputs = {};
export type Settings_Password_GroupInputs = {};
export type Settings_Password_MismatchInputs = {};
export type Settings_Password_NewInputs = {};
export type Settings_Password_NoneInputs = {};
export type Settings_Password_None_SubInputs = {};
export type Settings_Password_Not_This_BrowserInputs = {};
export type Settings_Password_Not_This_Browser_SubInputs = {};
export type Settings_Password_RepeatInputs = {};
export type Settings_Password_Sign_OutInputs = {};
export type Settings_Password_This_BrowserInputs = {};
export type Settings_Password_This_Browser_SubInputs = {};
export type Settings_Password_Too_ShortInputs = {};
export type Settings_Password_UnreachableInputs = {};
export type Settings_Section_AccountsInputs = {};
export type Settings_Section_ConnectionsInputs = {};
export type Settings_Section_GeneralInputs = {};
export type Settings_Section_NotificationsInputs = {};
export type Settings_Section_VoiceInputs = {};
export type Settings_SectionsInputs = {};
export type Settings_SetInputs = {};
export type Settings_Studio_AddressInputs = {};
export type Settings_Studio_CancelInputs = {};
export type Settings_Studio_CodeInputs = {};
export type Settings_Studio_Code_CopyInputs = { host: NonNullable<unknown> };
export type Settings_Studio_Code_LabelInputs = {};
export type Settings_Studio_Code_Sends_BackInputs = { host: NonNullable<unknown> };
export type Settings_Studio_Env_KeyInputs = { host: NonNullable<unknown> };
export type Settings_Studio_GroupInputs = {};
export type Settings_Studio_OpenInputs = {};
export type Settings_Studio_Showing_CodeInputs = {};
export type Settings_Studio_Sign_InInputs = {};
export type Settings_Studio_Sign_In_SubInputs = {};
export type Settings_Studio_Sign_In_TitleInputs = {};
export type Settings_Studio_Sign_OutInputs = {};
export type Settings_Studio_Sign_Out_TitleInputs = {};
export type Settings_Studio_Signed_InInputs = {};
export type Settings_Studio_Signed_In_AsInputs = { email: NonNullable<unknown> };
export type Settings_Studio_Syncs_ThereInputs = { host: NonNullable<unknown> };
export type Settings_Sync_AmountsInputs = { done: NonNullable<unknown>, total: NonNullable<unknown>, filesDone: NonNullable<unknown>, filesTotal: NonNullable<unknown> };
export type Settings_Sync_CheckingInputs = {};
export type Settings_Sync_ComparingInputs = {};
export type Settings_Sync_ConnectingInputs = {};
export type Settings_Sync_Connecting_SubInputs = {};
export type Settings_Sync_FinishingInputs = {};
export type Settings_Sync_HeldInputs = {};
export type Settings_Sync_Held_SubInputs = {};
export type Settings_Sync_HideInputs = {};
export type Settings_Sync_LabelInputs = {};
export type Settings_Sync_LeftInputs = { time: NonNullable<unknown> };
export type Settings_Sync_Left_OutInputs = { count: NonNullable<unknown> };
export type Settings_Sync_Left_Out_SubInputs = {};
export type Settings_Sync_OfflineInputs = {};
export type Settings_Sync_Offline_SubInputs = { why: NonNullable<unknown> };
export type Settings_Sync_Offline_Sub_SinceInputs = { why: NonNullable<unknown>, time: NonNullable<unknown> };
export type Settings_Sync_RetryInputs = {};
export type Settings_Sync_ShowInputs = {};
export type Settings_Sync_SinceInputs = { time: NonNullable<unknown> };
export type Settings_Sync_SyncedInputs = {};
export type Settings_Sync_Synced_SubInputs = {};
export type Settings_Sync_Synced_Sub_CheckedInputs = { count: NonNullable<unknown> };
export type Settings_Sync_SyncingInputs = {};
export type Settings_Sync_UnreachableInputs = {};
export type Settings_Sync_With_SpeedInputs = { amounts: NonNullable<unknown>, speed: NonNullable<unknown> };
export type Settings_TimeInputs = {};
export type Settings_TimezoneInputs = {};
export type Settings_Timezone_BackInputs = { zone: NonNullable<unknown> };
export type Settings_Timezone_NowInputs = { time: NonNullable<unknown> };
export type Settings_Timezone_OtherInputs = {};
export type Settings_Timezone_Other_SubInputs = {};
export type Settings_Timezone_SetInputs = { zone: NonNullable<unknown> };
export type Settings_Timezone_UnknownInputs = {};
export type Settings_Timezone_UnsetInputs = { zone: NonNullable<unknown> };
export type Settings_Timezone_UseInputs = { zone: NonNullable<unknown> };
export type Settings_Timezone_Use_ServerInputs = {};
export type Settings_TitleInputs = {};
export type Settings_Usage_AgentsInputs = {};
export type Settings_Usage_Api_TimeInputs = {};
export type Settings_Usage_Behavior_Cache_MissInputs = {};
export type Settings_Usage_Behavior_CronInputs = {};
export type Settings_Usage_Behavior_High_ParallelInputs = {};
export type Settings_Usage_Behavior_Long_ContextInputs = {};
export type Settings_Usage_Behavior_Subagent_HeavyInputs = {};
export type Settings_Usage_BehaviorsInputs = {};
export type Settings_Usage_Behaviors_NoteInputs = {};
export type Settings_Usage_Cache_ReadInputs = {};
export type Settings_Usage_Cache_RwInputs = {};
export type Settings_Usage_Cache_WriteInputs = {};
export type Settings_Usage_ConversationInputs = {};
export type Settings_Usage_Conversation_NoteInputs = {};
export type Settings_Usage_CostInputs = {};
export type Settings_Usage_DayInputs = {};
export type Settings_Usage_DormantInputs = {};
export type Settings_Usage_Dormant_TitleInputs = {};
export type Settings_Usage_Dormant_TurnsInputs = { left: NonNullable<unknown> };
export type Settings_Usage_ElapsedInputs = {};
export type Settings_Usage_FailedInputs = { message: NonNullable<unknown> };
export type Settings_Usage_InInputs = {};
export type Settings_Usage_LimitsInputs = {};
export type Settings_Usage_Limits_NoteInputs = {};
export type Settings_Usage_LinesInputs = {};
export type Settings_Usage_McpInputs = {};
export type Settings_Usage_ModelInputs = {};
export type Settings_Usage_No_PlanInputs = {};
export type Settings_Usage_No_ReadingInputs = {};
export type Settings_Usage_No_WindowsInputs = {};
export type Settings_Usage_NothingInputs = {};
export type Settings_Usage_NowInputs = {};
export type Settings_Usage_Of_ContextInputs = {};
export type Settings_Usage_OutInputs = {};
export type Settings_Usage_Per_TokenInputs = { kind: NonNullable<unknown> };
export type Settings_Usage_PlanInputs = { name: NonNullable<unknown> };
export type Settings_Usage_PluginsInputs = {};
export type Settings_Usage_Read_AgainInputs = {};
export type Settings_Usage_ReadingInputs = {};
export type Settings_Usage_Reading_AgainInputs = { ago: NonNullable<unknown> };
export type Settings_Usage_RequestsInputs = { count: NonNullable<unknown>, shown: NonNullable<unknown> };
export type Settings_Usage_Requests_AcrossInputs = { requests: NonNullable<unknown>, count: NonNullable<unknown> };
export type Settings_Usage_Resets_InInputs = { left: NonNullable<unknown> };
export type Settings_Usage_ResettingInputs = {};
export type Settings_Usage_SkillsInputs = {};
export type Settings_Usage_TitleInputs = {};
export type Settings_Usage_Tokens_OfInputs = { used: NonNullable<unknown>, window: NonNullable<unknown> };
export type Settings_Usage_WeekInputs = {};
export type Settings_Usage_Window_EmptyInputs = {};
export type Settings_Voice_FootInputs = {};
export type Settings_Voice_Lang_LabelInputs = {};
export type Settings_Voice_Lang_SubInputs = {};
export type Settings_Voice_ModelInputs = {};
export type Settings_Voice_Model_LabelInputs = {};
export type Settings_Voice_No_KeyInputs = {};
export type Settings_Voice_RecogniserInputs = {};
export type Settings_Voice_Stt_4oInputs = {};
export type Settings_Voice_Stt_GptInputs = {};
export type Settings_Voice_Stt_MiniInputs = {};
export type Settings_Voice_Stt_WhisperInputs = {};
export type Shell_Agent_HereInputs = { name: NonNullable<unknown> };
export type Shell_AgentsInputs = {};
export type Shell_Agents_CurrentInputs = { name: NonNullable<unknown> };
export type Shell_Agents_HereInputs = {};
export type Shell_Back_Into_PillInputs = {};
export type Shell_Bring_BackInputs = {};
export type Shell_CanvasesInputs = {};
export type Shell_Canvases_CurrentInputs = { name: NonNullable<unknown> };
export type Shell_Canvases_NoneInputs = {};
export type Shell_CloseInputs = {};
export type Shell_Context_UsageInputs = {};
export type Shell_Conversation_HeightInputs = {};
export type Shell_Fold_ConversationInputs = {};
export type Shell_Grip_FloatInputs = {};
export type Shell_Grip_PanelInputs = {};
export type Shell_MoreInputs = {};
export type Shell_No_AgentInputs = {};
export type Shell_No_CanvasInputs = {};
export type Shell_PicturesInputs = {};
export type Shell_Pictures_CheckingInputs = {};
export type Shell_Pictures_Done_TitleInputs = {};
export type Shell_Pictures_MadeInputs = { ready: NonNullable<unknown>, total: NonNullable<unknown> };
export type Shell_Pictures_Made_FailedInputs = { ready: NonNullable<unknown>, total: NonNullable<unknown>, failed: NonNullable<unknown> };
export type Shell_Pictures_Making_TitleInputs = {};
export type Shell_Pictures_ReadyInputs = {};
export type Shell_PresentInputs = {};
export type Shell_Show_ConversationInputs = {};
export type Shell_Show_PanelInputs = {};
export type Shell_StatusInputs = { name: NonNullable<unknown>, state: NonNullable<unknown> };
export type Shell_Switch_AgentInputs = {};
export type Shell_Talk_ToInputs = { name: NonNullable<unknown> };
export type Shell_The_ConversationInputs = {};
export type Shell_View_OnlyInputs = {};
export type Shell_View_Only_TitleInputs = { owner: NonNullable<unknown> };
export type Shell_Waiting_For_YouInputs = {};
export type State_An_AgentInputs = {};
export type State_Call_FailedInputs = {};
export type State_Line_DroppedInputs = {};
export type State_Line_Dropped_WhyInputs = { reason: NonNullable<unknown> };
export type Tabs_A_TabInputs = { name: NonNullable<unknown> };
export type Tabs_ActionsInputs = { name: NonNullable<unknown> };
export type Tabs_All_TabsInputs = {};
export type Tabs_AppsInputs = {};
export type Tabs_CanvasesInputs = {};
export type Tabs_Card_GoneInputs = {};
export type Tabs_CardsInputs = {};
export type Tabs_Close_NamedInputs = { name: NonNullable<unknown> };
export type Tabs_Close_TabInputs = {};
export type Tabs_DocumentInputs = {};
export type Tabs_Document_GoneInputs = {};
export type Tabs_Document_No_CanvasInputs = {};
export type Tabs_DocumentsInputs = {};
export type Tabs_FindInputs = {};
export type Tabs_Link_GoneInputs = { target: NonNullable<unknown> };
export type Tabs_Link_Gone_AppInputs = { target: NonNullable<unknown> };
export type Tabs_Link_Gone_CanvasInputs = { target: NonNullable<unknown> };
export type Tabs_Link_Gone_CardInputs = { target: NonNullable<unknown> };
export type Tabs_Link_Gone_DocumentInputs = { target: NonNullable<unknown> };
export type Tabs_Link_NothingInputs = { address: NonNullable<unknown> };
export type Tabs_Link_ToInputs = {};
export type Tabs_Link_To_FindInputs = {};
export type Tabs_No_CanvasInputs = {};
export type Tabs_Not_On_CanvasInputs = { canvas: NonNullable<unknown> };
export type Tabs_On_CanvasInputs = {};
export type Tabs_On_Canvas_TipInputs = {};
export type Tabs_On_No_CanvasInputs = {};
export type Tabs_Open_A_TabInputs = {};
export type Tabs_Open_CountInputs = { count: NonNullable<unknown> };
export type Tabs_Open_In_BrowserInputs = {};
export type Tabs_ReloadInputs = {};
export type Tabs_Reload_TipInputs = {};
export type Tabs_TabsInputs = {};
export type Ui_Scribble_LabelInputs = {};
export {};
