# @decks/i18n

Every word Decks shows a person, in English and Simplified Chinese.

```tsx
import { m, formatAgo, formatNumber } from "@decks/i18n";

<button title={m.tabs_close_title({ name })}>{m.tabs_close()}</button>
<span>{formatAgo(card.changedAt)}</span>
```

- **Messages** live in `messages/<area>/<locale>.json` (`en.json`, `zh-CN.json`). An area is a folder of
  the app (`settings`, `composer`, `canvas`, `chat`, …). Every key starts with its area and an
  underscore, in snake_case: `composer_send`, `canvas_menu_delete`.
- **Compile** after changing a message: `npm run compile -w @decks/i18n`. It writes `src/paraglide/`,
  which is committed. `npm run check -w @decks/i18n` fails when a language misses a message, a
  placeholder differs between languages, or the compiled code is stale.
- **The language** is the person's choice in Settings, General (kept in this browser as
  `decks.locale`), else the browser's languages, else English. A change reloads the page. A
  sandboxed canvas frame is told it in its address (`?lang=`).

## Writing a message

- Only what a **person** reads: text in JSX, `title`, `placeholder`, `aria-label`, labels of menus
  and buttons, toasts, empty states, confirm dialogs. Not what agents or the server read (refusals,
  notes to agents, tool descriptions, skills, protocol names, log lines), not code comments, not
  `data-*` values, CSS classes or ids.
- **A whole sentence is one message**, with placeholders for what changes: `"{count} files left
  out"`, never `count + " " + m.files_left_out()`. Word order differs between languages.
- **Plurals** use variants (Chinese needs only `other`, so its value can be a plain string):

  ```json
  "tabs_count": [{ "declarations": ["input count", "local n = count: plural"], "selectors": ["n"],
                   "match": { "n=one": "{count} tab", "n=other": "{count} tabs" } }]
  ```
- **Numbers, dates and times** are never written by hand: `formatNumber`, `formatBytes`, `formatAgo`,
  `formatDuration`, `formatList` here, and `clockTime`, `formatDate` in `@decks/ui` (the deck's timezone).
  A placeholder takes the already formatted string.
- A message read at module load is read once, before the language is known on some pages: put the
  call inside the component or a function (`label: () => m.x()`), not in a top-level constant.
- **Names stay**: Decks, Claude, Chrome, Studio, Pen, MCP, GitHub, model names, file names, key names
  (⌘K, Enter), and anything the person or an agent named (canvas titles, card titles, agent names).

## Chinese (zh-CN)

Short, plain UI Chinese, as in macOS and Figma in Chinese: no 您 (use nothing, or 你), no
exclamation marks, full-width punctuation (，。：？（）), a space between Chinese and Latin words or
numbers (`3 个文件`, `打开 Studio`). Buttons are verbs of two to four characters where possible.

| English | 中文 | | English | 中文 |
| --- | --- | --- | --- | --- |
| canvas | 画布 | | agent | 智能体 |
| card | 卡片 | | deck | 卡组 |
| document | 文档 | | app | 应用 |
| drawing | 绘图 | | note (sticky) | 便签 |
| tab | 标签页 | | frame (pen) | 画框 |
| comment | 评论 | | ink / pen | 墨迹 / 笔 |
| conversation / chat | 对话 | | message | 消息 |
| composer | 输入框 | | turn | 回合 |
| task | 任务 | | queue | 队列 |
| settings | 设置 | | sync | 同步 |
| harness | 本机服务 | | server | 服务器 |
| sign in / out | 登录 / 退出登录 | | pair / pairing code | 配对 / 配对码 |
| share | 共享 | | permission | 权限 |
| undo / redo | 撤销 / 重做 | | copy / paste | 拷贝 / 粘贴 |
| delete | 删除 | | rename | 重命名 |
| fit | 适应 | | focus | 聚焦 |
| zoom | 缩放 | | select | 选择 |
| reload | 重新加载 | | run / stop | 运行 / 停止 |
| upload / download | 上传 / 下载 | | export | 导出 |
| model | 模型 | | thinking | 思考 |
| notification | 通知 | | voice | 语音 |
| workspace | 项目 | | tag | 标签 |
