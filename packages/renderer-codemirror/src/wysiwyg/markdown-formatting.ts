import {
  EditorSelection,
  Transaction,
  type EditorState,
  type StateCommand,
} from "@codemirror/state";
import { keymap, type Command, type EditorView } from "@codemirror/view";
import { authorizeWysiwygProtectedChange } from "./change-authorization.ts";
import { wysiwygProjectionField } from "./projection-state.ts";

/**
 * 校验是否可在当前状态下执行结构化/格式化命令
 */
function canRunFormattingCommand(state: EditorState): boolean {
  const projection = state.field(wysiwygProjectionField, false);
  return !projection || projection.compositionGuardRanges.length === 0;
}

function guarded(command: StateCommand): StateCommand {
  return (target) => (canRunFormattingCommand(target.state) ? command(target) : false);
}

export function viewFormattingCommand(command: StateCommand): Command {
  return (view: EditorView) => {
    if (view.composing) {
      return false;
    }
    return command({
      state: view.state,
      dispatch: (transaction) => view.dispatch(transaction),
    });
  };
}

/**
 * 切换行内标记包裹（如 **粗体**、*斜体*、~~删除线~~、`行内代码`、==高亮==）
 */
export function toggleInlineMarkup(
  delimiter: string,
  options: { readonly closingDelimiter?: string } = {},
): StateCommand {
  const openDelim = delimiter;
  const closeDelim = options.closingDelimiter ?? delimiter;
  const openLen = openDelim.length;
  const closeLen = closeDelim.length;

  return ({ state, dispatch }) => {
    const changes: { from: number; to: number; insert: string }[] = [];
    const newRanges: { anchor: number; head: number }[] = [];

    // 从后往前处理各选区以防偏移错乱
    const sortedRanges = state.selection.ranges.toSorted((a, b) => b.from - a.from);

    for (const range of sortedRanges) {
      if (range.empty) {
        const pos = range.from;
        // 检查光标是否正好处于 delimiter 内侧：delim|delim
        const before = state.sliceDoc(Math.max(0, pos - openLen), pos);
        const after = state.sliceDoc(pos, Math.min(state.doc.length, pos + closeLen));

        if (before === openDelim && after === closeDelim) {
          // 解包：删除前后定界符
          changes.push({ from: pos - openLen, to: pos + closeLen, insert: "" });
          newRanges.push({ anchor: pos - openLen, head: pos - openLen });
        } else {
          // 插入一对定界符，并将光标置于其中
          changes.push({ from: pos, to: pos, insert: `${openDelim}${closeDelim}` });
          newRanges.push({ anchor: pos + openLen, head: pos + openLen });
        }
      } else {
        const from = range.from;
        const to = range.to;
        const selectedText = state.sliceDoc(from, to);

        // 1. 选区本身是否首尾自带有 delimiter
        if (
          selectedText.length >= openLen + closeLen &&
          selectedText.startsWith(openDelim) &&
          selectedText.endsWith(closeDelim)
        ) {
          const unwrapped = selectedText.slice(openLen, selectedText.length - closeLen);
          changes.push({ from, to, insert: unwrapped });
          newRanges.push({ anchor: from, head: from + unwrapped.length });
          continue;
        }

        // 2. 选区外部是否被 delimiter 紧密包裹
        const outerBefore = state.sliceDoc(Math.max(0, from - openLen), from);
        const outerAfter = state.sliceDoc(to, Math.min(state.doc.length, to + closeLen));

        if (outerBefore === openDelim && outerAfter === closeDelim) {
          changes.push({ from: from - openLen, to: to + closeLen, insert: selectedText });
          newRanges.push({ anchor: from - openLen, head: from - openLen + selectedText.length });
          continue;
        }

        // 3. 正常包裹
        const wrapped = `${openDelim}${selectedText}${closeDelim}`;
        changes.push({ from, to, insert: wrapped });
        newRanges.push({ anchor: from + openLen, head: from + openLen + selectedText.length });
      }
    }

    const finalRanges = newRanges.toReversed();

    dispatch(
      state.update({
        changes,
        selection: EditorSelection.create(
          finalRanges.map((r) => EditorSelection.range(r.anchor, r.head)),
        ),
        annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
        userEvent: "input.format",
      }),
    );
    return true;
  };
}

/**
 * 插入或包裹链接 [text](url)
 */
export const insertOrWrapLinkCommand: StateCommand = ({ state, dispatch }) => {
  const main = state.selection.main;
  if (main.empty) {
    const pos = main.from;
    dispatch(
      state.update({
        changes: { from: pos, to: pos, insert: "[](url)" },
        selection: EditorSelection.cursor(pos + 1),
        annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
        userEvent: "input.format",
      }),
    );
    return true;
  }

  const selectedText = state.sliceDoc(main.from, main.to);
  // 如果已是 [text](url) 形式，解包为 text
  const linkMatch = /^\[(.*?)\]\((.*?)\)$/.exec(selectedText);
  if (linkMatch) {
    const innerText = linkMatch[1] ?? "";
    dispatch(
      state.update({
        changes: { from: main.from, to: main.to, insert: innerText },
        selection: EditorSelection.range(main.from, main.from + innerText.length),
        annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
        userEvent: "input.format",
      }),
    );
    return true;
  }

  const wrapped = `[${selectedText}](url)`;
  dispatch(
    state.update({
      changes: { from: main.from, to: main.to, insert: wrapped },
      // 选中 "url" 占位符，方便用户直接输入/粘贴链接
      selection: EditorSelection.range(
        main.from + selectedText.length + 3,
        main.from + selectedText.length + 6,
      ),
      annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
      userEvent: "input.format",
    }),
  );
  return true;
};

/**
 * 插入独立代码块 ```\n\n```
 */
export const insertCodeBlockCommand: StateCommand = ({ state, dispatch }) => {
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  const selectedText = state.sliceDoc(main.from, main.to);

  let insertText = "";
  let cursorOffset = 0;

  if (main.empty) {
    const prefix = line.text.length > 0 ? "\n" : "";
    insertText = `${prefix}\`\`\`\n\n\`\`\`\n`;
    cursorOffset = prefix.length + 4; // 光标停在代码块内容第一行
  } else {
    insertText = `\`\`\`\n${selectedText}\n\`\`\`\n`;
    cursorOffset = 4;
  }

  dispatch(
    state.update({
      changes: { from: main.from, to: main.to, insert: insertText },
      selection: EditorSelection.cursor(main.from + cursorOffset),
      annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
      userEvent: "input.format",
    }),
  );
  return true;
};

/**
 * 切换标题级别（1-6 级）或转为普通段落（0 级）
 */
export function toggleHeadingLevel(level: number): StateCommand {
  return ({ state, dispatch }) => {
    const changes: { from: number; to: number; insert: string }[] = [];
    const linesTouched = new Set<number>();

    for (const range of state.selection.ranges) {
      const startLine = state.doc.lineAt(range.from).number;
      const endLine = state.doc.lineAt(range.to).number;
      for (let ln = startLine; ln <= endLine; ln++) {
        linesTouched.add(ln);
      }
    }

    const sortedLines = [...linesTouched].toSorted((a, b) => b - a);

    for (const lineNum of sortedLines) {
      const line = state.doc.line(lineNum);
      const text = line.text;
      const headingMatch = /^(#{1,6})\s+/.exec(text);

      if (level === 0) {
        // 转为普通段落：移除已有标题标记
        if (headingMatch) {
          changes.push({ from: line.from, to: line.from + headingMatch[0].length, insert: "" });
        }
      } else {
        const targetPrefix = `${"#".repeat(level)} `;
        if (headingMatch) {
          if (headingMatch[1].length === level) {
            // 当前正好是该级别：反转清除标题（转为段落）
            changes.push({ from: line.from, to: line.from + headingMatch[0].length, insert: "" });
          } else {
            // 切换为目标级别
            changes.push({
              from: line.from,
              to: line.from + headingMatch[0].length,
              insert: targetPrefix,
            });
          }
        } else {
          // 当前为普通行：在行首插入标题前缀
          changes.push({ from: line.from, to: line.from, insert: targetPrefix });
        }
      }
    }

    if (changes.length === 0) {
      return false;
    }

    dispatch(
      state.update({
        changes,
        annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
        userEvent: "input.format",
      }),
    );
    return true;
  };
}

/**
 * 切换引用块（> ）
 */
export const toggleBlockquoteCommand: StateCommand = ({ state, dispatch }) => {
  const linesTouched = new Set<number>();

  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let ln = startLine; ln <= endLine; ln++) {
      linesTouched.add(ln);
    }
  }

  const sortedLines = [...linesTouched].toSorted((a, b) => b - a);
  const changes: { from: number; to: number; insert: string }[] = [];

  // 判断是否所有选中行都已经是以 "> " 开头
  const allQuoted = [...linesTouched].every((ln) => /^>\s?/.test(state.doc.line(ln).text));

  for (const lineNum of sortedLines) {
    const line = state.doc.line(lineNum);
    const quoteMatch = /^>\s?/.exec(line.text);
    if (allQuoted && quoteMatch) {
      // 全部已引用 -> 统一解引
      changes.push({ from: line.from, to: line.from + quoteMatch[0].length, insert: "" });
    } else if (!allQuoted && !quoteMatch) {
      // 加引用
      changes.push({ from: line.from, to: line.from, insert: "> " });
    }
  }

  if (changes.length === 0) {
    return false;
  }

  dispatch(
    state.update({
      changes,
      annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
      userEvent: "input.format",
    }),
  );
  return true;
};

/**
 * 切换无序列表项（- ）
 */
export const toggleBulletListCommand: StateCommand = ({ state, dispatch }) => {
  const linesTouched = new Set<number>();
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let ln = startLine; ln <= endLine; ln++) {
      linesTouched.add(ln);
    }
  }

  const sortedLines = [...linesTouched].toSorted((a, b) => b - a);
  const allBulleted = [...linesTouched].every((ln) => /^\s*[-*+]\s+/.test(state.doc.line(ln).text));
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const lineNum of sortedLines) {
    const line = state.doc.line(lineNum);
    const bulletMatch = /^(\s*)([-*+]\s+)/.exec(line.text);
    if (allBulleted && bulletMatch) {
      changes.push({
        from: line.from + bulletMatch[1].length,
        to: line.from + bulletMatch[0].length,
        insert: "",
      });
    } else if (!allBulleted) {
      if (bulletMatch) {
        // 已有其他 bullet，保持
      } else {
        const indentMatch = /^(\s*)/.exec(line.text);
        const indentLen = indentMatch ? indentMatch[1].length : 0;
        changes.push({ from: line.from + indentLen, to: line.from + indentLen, insert: "- " });
      }
    }
  }

  if (changes.length === 0) {
    return false;
  }

  dispatch(
    state.update({
      changes,
      annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
      userEvent: "input.format",
    }),
  );
  return true;
};

/**
 * 切换有序列表项（1. 2. 3. ）
 */
export const toggleOrderedListCommand: StateCommand = ({ state, dispatch }) => {
  const linesTouched = new Set<number>();
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let ln = startLine; ln <= endLine; ln++) {
      linesTouched.add(ln);
    }
  }

  const sortedLines = [...linesTouched].toSorted((a, b) => a - b);
  const allOrdered = sortedLines.every((ln) => /^\s*\d+\.\s+/.test(state.doc.line(ln).text));
  const changes: { from: number; to: number; insert: string }[] = [];

  let orderIndex = 1;
  // 从后往前构建 changes
  for (const lineNum of sortedLines.toReversed()) {
    const line = state.doc.line(lineNum);
    const orderMatch = /^(\s*)(\d+\.\s+)/.exec(line.text);
    if (allOrdered && orderMatch) {
      changes.push({
        from: line.from + orderMatch[1].length,
        to: line.from + orderMatch[0].length,
        insert: "",
      });
    }
  }

  if (!allOrdered) {
    for (const lineNum of sortedLines) {
      const line = state.doc.line(lineNum);
      const orderMatch = /^(\s*)(\d+\.\s+)/.exec(line.text);
      if (!orderMatch) {
        const indentMatch = /^(\s*)/.exec(line.text);
        const indentLen = indentMatch ? indentMatch[1].length : 0;
        changes.push({
          from: line.from + indentLen,
          to: line.from + indentLen,
          insert: `${orderIndex}. `,
        });
      }
      orderIndex++;
    }
  }

  if (changes.length === 0) {
    return false;
  }

  dispatch(
    state.update({
      changes,
      annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
      userEvent: "input.format",
    }),
  );
  return true;
};

/**
 * 切换任务列表项（- [ ] ）
 */
export const toggleTaskListCommand: StateCommand = ({ state, dispatch }) => {
  const linesTouched = new Set<number>();
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let ln = startLine; ln <= endLine; ln++) {
      linesTouched.add(ln);
    }
  }

  const sortedLines = [...linesTouched].toSorted((a, b) => b - a);
  const allTask = [...linesTouched].every((ln) =>
    /^\s*[-*+]\s+\[[ xX]\]\s+/.test(state.doc.line(ln).text),
  );
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const lineNum of sortedLines) {
    const line = state.doc.line(lineNum);
    const taskMatch = /^(\s*)([-*+]\s+\[[ xX]\]\s+)/.exec(line.text);
    if (allTask && taskMatch) {
      changes.push({
        from: line.from + taskMatch[1].length,
        to: line.from + taskMatch[0].length,
        insert: "",
      });
    } else if (!allTask) {
      if (taskMatch) {
        // 已是任务项
      } else {
        const bulletMatch = /^(\s*)([-*+]\s+)/.exec(line.text);
        if (bulletMatch) {
          changes.push({
            from: line.from + bulletMatch[0].length,
            to: line.from + bulletMatch[0].length,
            insert: "[ ] ",
          });
        } else {
          const indentMatch = /^(\s*)/.exec(line.text);
          const indentLen = indentMatch ? indentMatch[1].length : 0;
          changes.push({
            from: line.from + indentLen,
            to: line.from + indentLen,
            insert: "- [ ] ",
          });
        }
      }
    }
  }

  if (changes.length === 0) {
    return false;
  }

  dispatch(
    state.update({
      changes,
      annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
      userEvent: "input.format",
    }),
  );
  return true;
};

// 导出包装好受保护守卫的标准格式命令
export const toggleBold: StateCommand = guarded(toggleInlineMarkup("**"));
export const toggleItalic: StateCommand = guarded(toggleInlineMarkup("*"));
export const toggleStrikethrough: StateCommand = guarded(toggleInlineMarkup("~~"));
export const toggleInlineCode: StateCommand = guarded(toggleInlineMarkup("`"));
export const toggleHighlight: StateCommand = guarded(toggleInlineMarkup("=="));
export const insertOrWrapLink: StateCommand = guarded(insertOrWrapLinkCommand);
export const insertCodeBlock: StateCommand = guarded(insertCodeBlockCommand);
export const toggleBlockquote: StateCommand = guarded(toggleBlockquoteCommand);
export const toggleBulletList: StateCommand = guarded(toggleBulletListCommand);
export const toggleOrderedList: StateCommand = guarded(toggleOrderedListCommand);
export const toggleTaskList: StateCommand = guarded(toggleTaskListCommand);
export const setParagraph: StateCommand = guarded(toggleHeadingLevel(0));
export const setHeading1: StateCommand = guarded(toggleHeadingLevel(1));
export const setHeading2: StateCommand = guarded(toggleHeadingLevel(2));
export const setHeading3: StateCommand = guarded(toggleHeadingLevel(3));
export const setHeading4: StateCommand = guarded(toggleHeadingLevel(4));
export const setHeading5: StateCommand = guarded(toggleHeadingLevel(5));
export const setHeading6: StateCommand = guarded(toggleHeadingLevel(6));

/**
 * 创建 Markdown 常用格式化快捷键扩展
 */
export function createMarkdownFormattingKeymap() {
  return keymap.of([
    { key: "Mod-b", run: viewFormattingCommand(toggleBold) },
    { key: "Mod-i", run: viewFormattingCommand(toggleItalic) },
    { key: "Mod-k", run: viewFormattingCommand(insertOrWrapLink) },
    { key: "Mod-e", run: viewFormattingCommand(toggleInlineCode) },
    { key: "Mod-`", run: viewFormattingCommand(toggleInlineCode) },
    { key: "Mod-Shift-s", run: viewFormattingCommand(toggleStrikethrough) },
    { key: "Mod-Shift-x", run: viewFormattingCommand(toggleStrikethrough) },
    { key: "Mod-Shift-h", run: viewFormattingCommand(toggleHighlight) },
    { key: "Mod-Shift-q", run: viewFormattingCommand(toggleBlockquote) },
    { key: "Mod-Shift-c", run: viewFormattingCommand(insertCodeBlock) },
    { key: "Mod-Shift-k", run: viewFormattingCommand(insertCodeBlock) },
    { key: "Mod-Shift-u", run: viewFormattingCommand(toggleBulletList) },
    { key: "Mod-Shift-o", run: viewFormattingCommand(toggleOrderedList) },
    { key: "Mod-Shift-t", run: viewFormattingCommand(toggleTaskList) },
    { key: "Mod-Alt-0", run: viewFormattingCommand(setParagraph) },
    { key: "Mod-Alt-1", run: viewFormattingCommand(setHeading1) },
    { key: "Mod-Alt-2", run: viewFormattingCommand(setHeading2) },
    { key: "Mod-Alt-3", run: viewFormattingCommand(setHeading3) },
    { key: "Mod-Alt-4", run: viewFormattingCommand(setHeading4) },
    { key: "Mod-Alt-5", run: viewFormattingCommand(setHeading5) },
    { key: "Mod-Alt-6", run: viewFormattingCommand(setHeading6) },
  ]);
}
