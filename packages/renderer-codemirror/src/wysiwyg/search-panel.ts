import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { type EditorView, type Panel } from "@codemirror/view";

/**
 * 格式化 SVG 图标辅助函数
 */
function createSvgIcon(svgContent: string, size = 14): Element {
  const span = document.createElement("span");
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgContent}</svg>`;
  return span.firstElementChild ?? span;
}

const SEARCH_ICON = `<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>`;
const CHEVRON_UP = `<polyline points="18 15 12 9 6 15"></polyline>`;
const CHEVRON_DOWN = `<polyline points="6 9 12 15 18 9"></polyline>`;
const CLOSE_ICON = `<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>`;
const REPLACE_ICON = `<polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path>`;
const EXPAND_ICON = `<polyline points="7 10 12 15 17 10"></polyline>`;

/**
 * 计算当前光标所在匹配序号与总匹配数
 */
function computeMatchStatus(
  view: EditorView,
  query: SearchQuery,
): { current: number; total: number } {
  if (!query.search) {
    return { current: 0, total: 0 };
  }

  const cursor = query.getCursor(view.state.doc);
  let total = 0;
  let current = 0;
  const mainHead = view.state.selection.main.head;

  let item = cursor.next();
  while (!item.done) {
    total++;
    // 如果光标在该匹配范围内或刚好在前面
    if (mainHead >= item.value.from && mainHead <= item.value.to) {
      current = total;
    } else if (current === 0 && mainHead < item.value.from) {
      // 光标在匹配项之前
      current = total;
    }
    item = cursor.next();
  }

  if (total > 0 && current === 0) {
    current = total;
  }

  return { current, total };
}

/**
 * 打造 Apple Liquid Glass 风格的文档内搜索与替换悬浮面板
 */
export function createLiquidSearchPanel(view: EditorView): Panel {
  const initialQuery = getSearchQuery(view.state);
  let isReplaceOpen = false;
  let caseSensitive = initialQuery.caseSensitive;
  let wholeWord = initialQuery.wholeWord;
  let regexp = initialQuery.regexp;

  // 1. 主容器 DOM
  const dom = document.createElement("div");
  dom.className = "cm-search-liquid-panel";

  // 2. 搜索行
  const searchRow = document.createElement("div");
  searchRow.className = "cm-search-row";

  // 搜索图标
  const searchIcon = document.createElement("div");
  searchIcon.className = "cm-search-icon-slot";
  searchIcon.appendChild(createSvgIcon(SEARCH_ICON, 14));

  // 搜索输入框
  const searchInput = document.createElement("input");
  searchInput.className = "cm-search-input";
  searchInput.placeholder = "在文档中查找... (Enter 下一个)";
  searchInput.value = initialQuery.search;
  searchInput.spellcheck = false;

  // 匹配计数 Badge
  const countBadge = document.createElement("span");
  countBadge.className = "cm-search-badge";
  countBadge.textContent = "";

  // 导航按钮组 (上一个 / 下一个)
  const prevBtn = document.createElement("button");
  prevBtn.className = "cm-search-icon-button";
  prevBtn.title = "上一个 (Shift+Enter / ⇧⌘G)";
  prevBtn.type = "button";
  prevBtn.appendChild(createSvgIcon(CHEVRON_UP, 13));

  const nextBtn = document.createElement("button");
  nextBtn.className = "cm-search-icon-button";
  nextBtn.title = "下一个 (Enter / ⌘G)";
  nextBtn.type = "button";
  nextBtn.appendChild(createSvgIcon(CHEVRON_DOWN, 13));

  // 分隔线
  const divider = document.createElement("div");
  divider.className = "cm-search-divider";

  // 过滤开关组 (Aa, \b, .*)
  const filterGroup = document.createElement("div");
  filterGroup.className = "cm-search-filter-group";

  const caseBtn = document.createElement("button");
  caseBtn.className = `cm-search-filter-btn${caseSensitive ? " active" : ""}`;
  caseBtn.title = "区分大小写 (Alt+⌘+C)";
  caseBtn.type = "button";
  caseBtn.textContent = "Aa";

  const wordBtn = document.createElement("button");
  wordBtn.className = `cm-search-filter-btn${wholeWord ? " active" : ""}`;
  wordBtn.title = "全词匹配 (Alt+⌘+W)";
  wordBtn.type = "button";
  wordBtn.textContent = "\\b";

  const regexBtn = document.createElement("button");
  regexBtn.className = `cm-search-filter-btn${regexp ? " active" : ""}`;
  regexBtn.title = "正则表达式 (Alt+⌘+R)";
  regexBtn.type = "button";
  regexBtn.textContent = ".*";

  filterGroup.appendChild(caseBtn);
  filterGroup.appendChild(wordBtn);
  filterGroup.appendChild(regexBtn);

  // 展开替换行按钮
  const toggleReplaceBtn = document.createElement("button");
  toggleReplaceBtn.className = "cm-search-icon-button";
  toggleReplaceBtn.title = "展开/折叠替换 (⌘H)";
  toggleReplaceBtn.type = "button";
  toggleReplaceBtn.appendChild(createSvgIcon(EXPAND_ICON, 13));

  // 关闭面板按钮
  const closeBtn = document.createElement("button");
  closeBtn.className = "cm-search-close-button";
  closeBtn.title = "关闭 (Esc)";
  closeBtn.type = "button";
  closeBtn.appendChild(createSvgIcon(CLOSE_ICON, 13));

  searchRow.appendChild(searchIcon);
  searchRow.appendChild(searchInput);
  searchRow.appendChild(countBadge);
  searchRow.appendChild(prevBtn);
  searchRow.appendChild(nextBtn);
  searchRow.appendChild(divider);
  searchRow.appendChild(filterGroup);
  searchRow.appendChild(toggleReplaceBtn);
  searchRow.appendChild(closeBtn);

  // 3. 替换行 (可折叠)
  const replaceRow = document.createElement("div");
  replaceRow.className = "cm-replace-row";
  replaceRow.style.display = "none";

  const replaceIcon = document.createElement("div");
  replaceIcon.className = "cm-search-icon-slot";
  replaceIcon.appendChild(createSvgIcon(REPLACE_ICON, 14));

  const replaceInput = document.createElement("input");
  replaceInput.className = "cm-search-input cm-replace-input";
  replaceInput.placeholder = "替换为... (Enter 替换当前)";
  replaceInput.value = initialQuery.replace;
  replaceInput.spellcheck = false;

  const replaceNextBtn = document.createElement("button");
  replaceNextBtn.className = "cm-search-pill-button";
  replaceNextBtn.type = "button";
  replaceNextBtn.textContent = "替换";

  const replaceAllBtn = document.createElement("button");
  replaceAllBtn.className = "cm-search-pill-button cm-search-pill-button--primary";
  replaceAllBtn.type = "button";
  replaceAllBtn.textContent = "全部替换";

  replaceRow.appendChild(replaceIcon);
  replaceRow.appendChild(replaceInput);
  replaceRow.appendChild(replaceNextBtn);
  replaceRow.appendChild(replaceAllBtn);

  dom.appendChild(searchRow);
  dom.appendChild(replaceRow);

  // 4. 事件与响应逻辑
  function updateQuery(): void {
    const query = new SearchQuery({
      search: searchInput.value,
      replace: replaceInput.value,
      caseSensitive,
      wholeWord,
      regexp,
    });
    view.dispatch({ effects: setSearchQuery.of(query) });
    updateCountDisplay();
  }

  function updateCountDisplay(): void {
    const query = getSearchQuery(view.state);
    if (!query.search) {
      countBadge.textContent = "";
      countBadge.style.display = "none";
      return;
    }

    const { current, total } = computeMatchStatus(view, query);
    countBadge.style.display = "inline-flex";
    if (total === 0) {
      countBadge.textContent = "无结果";
      countBadge.classList.add("no-match");
    } else {
      countBadge.textContent = `${current}/${total}`;
      countBadge.classList.remove("no-match");
    }
  }

  function toggleReplace(open?: boolean): void {
    isReplaceOpen = open !== undefined ? open : !isReplaceOpen;
    replaceRow.style.display = isReplaceOpen ? "flex" : "none";
    toggleReplaceBtn.classList.toggle("active", isReplaceOpen);
    if (isReplaceOpen) {
      replaceInput.focus();
      replaceInput.select();
    }
  }

  // 搜索输入即时过滤
  searchInput.addEventListener("input", () => {
    updateQuery();
  });

  replaceInput.addEventListener("input", () => {
    updateQuery();
  });

  // 键盘快捷键监听
  searchInput.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        findPrevious(view);
      } else {
        findNext(view);
      }
      updateCountDisplay();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(view);
      view.focus();
    } else if (event.key === "h" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      toggleReplace(true);
    }
  });

  replaceInput.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.metaKey || event.altKey) {
        replaceAll(view);
      } else {
        replaceNext(view);
      }
      updateCountDisplay();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  });

  // 按钮交互
  prevBtn.addEventListener("click", () => {
    findPrevious(view);
    updateCountDisplay();
  });

  nextBtn.addEventListener("click", () => {
    findNext(view);
    updateCountDisplay();
  });

  caseBtn.addEventListener("click", () => {
    caseSensitive = !caseSensitive;
    caseBtn.classList.toggle("active", caseSensitive);
    updateQuery();
  });

  wordBtn.addEventListener("click", () => {
    wholeWord = !wholeWord;
    wordBtn.classList.toggle("active", wholeWord);
    updateQuery();
  });

  regexBtn.addEventListener("click", () => {
    regexp = !regexp;
    regexBtn.classList.toggle("active", regexp);
    updateQuery();
  });

  toggleReplaceBtn.addEventListener("click", () => {
    toggleReplace();
  });

  closeBtn.addEventListener("click", () => {
    closeSearchPanel(view);
    view.focus();
  });

  replaceNextBtn.addEventListener("click", () => {
    replaceNext(view);
    updateCountDisplay();
  });

  replaceAllBtn.addEventListener("click", () => {
    replaceAll(view);
    updateCountDisplay();
  });

  return {
    dom,
    top: true,
    mount() {
      searchInput.focus();
      searchInput.select();
      updateCountDisplay();
    },
    update(update) {
      if (update.docChanged || update.selectionSet) {
        updateCountDisplay();
      }
    },
  };
}
