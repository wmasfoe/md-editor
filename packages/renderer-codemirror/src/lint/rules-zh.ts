/**
 * @file rules-zh.ts
 * @description MarkdownLint 规则的简体中文与繁体中文词典。
 */

export interface LocalizedRuleInfo {
  readonly alias: string;
  readonly description: string;
}

/**
 * 常用 markdownlint 规则简体中文对照词典
 */
export const MARKDOWNLINT_ZH_RULES: Record<string, LocalizedRuleInfo> = {
  MD001: {
    alias: "标题层级递增",
    description: "标题层级必须逐级递增",
  },
  MD002: {
    alias: "首个标题为H1",
    description: "文档首个标题必须是一级标题 (H1)",
  },
  MD003: {
    alias: "标题风格统一",
    description: "标题风格应保持一致",
  },
  MD004: {
    alias: "无序列表符号统一",
    description: "无序列表符号在同一作用域内应保持统一",
  },
  MD005: {
    alias: "列表缩进对齐",
    description: "同级列表项前缀缩进必须对齐",
  },
  MD006: {
    alias: "顶层列表顶格",
    description: "最外层列表项必须顶格起始",
  },
  MD007: {
    alias: "子列表缩进空格",
    description: "子列表缩进空格数不符合规范",
  },
  MD009: {
    alias: "行尾多余空格",
    description: "行尾不应存在多余空格",
  },
  MD010: {
    alias: "硬制表符缩进",
    description: "请使用空格缩进，避免硬制表符 (Tab)",
  },
  MD011: {
    alias: "反向链接语法",
    description: "链接语法写反，标准格式为 [文本](链接)",
  },
  MD012: {
    alias: "连续多个空行",
    description: "不应包含多个连续空行",
  },
  MD013: {
    alias: "单行字符超长",
    description: "单行字符数超过配置上限",
  },
  MD014: {
    alias: "终端命令前缀符号",
    description: "代码块中的命令无需添加 $ 前缀",
  },
  MD018: {
    alias: "标题缺少空格",
    description: "标题井号与正文之间需保留一个空格",
  },
  MD019: {
    alias: "标题多个空格",
    description: "标题井号与正文之间只能保留一个空格",
  },
  MD020: {
    alias: "闭合标题缺少空格",
    description: "闭合式标题前后缺少空格",
  },
  MD021: {
    alias: "闭合标题多个空格",
    description: "闭合式标题前后只能保留一个空格",
  },
  MD022: {
    alias: "标题四周空行",
    description: "标题上方与下方需各保留一行空行",
  },
  MD023: {
    alias: "标题必须顶格起始",
    description: "标题行必须从行首起始，不可缩进",
  },
  MD024: {
    alias: "重复的标题内容",
    description: "同级小节标题不应重复",
  },
  MD025: {
    alias: "单一一级主标题",
    description: "文档中只应包含一个一级标题 (H1)",
  },
  MD026: {
    alias: "标题末尾多余标点",
    description: "标题末尾不应包含标点符号",
  },
  MD027: {
    alias: "引用块多个空格",
    description: "引用块符号后面只能保留一个空格",
  },
  MD028: {
    alias: "引用块空行阻断",
    description: "引用块之间不应存在空行",
  },
  MD029: {
    alias: "有序列表序号前缀",
    description: "有序列表项的前缀序号必须递增",
  },
  MD030: {
    alias: "列表标记空格数量",
    description: "列表标记与内容之间空格数不符合规范",
  },
  MD031: {
    alias: "代码块四周空行",
    description: "代码块前后需各保留一行空行",
  },
  MD032: {
    alias: "列表四周空行",
    description: "列表前后需保留空行",
  },
  MD033: {
    alias: "内联HTML标签",
    description: "不应直接使用 HTML 标签",
  },
  MD034: {
    alias: "裸露裸写URL",
    description: "网址与邮箱应使用有效链接语法，避免裸 URL",
  },
  MD035: {
    alias: "分割线风格统一",
    description: "分割线样式应全篇保持统一",
  },
  MD036: {
    alias: "加粗/斜体滥充标题",
    description: "不应用加粗或斜体文本充当标题",
  },
  MD037: {
    alias: "加粗/斜体内侧多余空格",
    description: "行内格式标记内侧不应有多余空格",
  },
  MD038: {
    alias: "行内代码内侧多余空格",
    description: "行内代码反引号内侧不应有多余空格",
  },
  MD039: {
    alias: "链接文本内侧多余空格",
    description: "链接中括号内侧不应有多余空格",
  },
  MD040: {
    alias: "代码块未指定语言",
    description: "代码块必须指定语法高亮语言",
  },
  MD041: {
    alias: "首行必须是标题",
    description: "文档首行应当是一级标题",
  },
  MD042: {
    alias: "空链接",
    description: "链接目标地址不能为空",
  },
  MD043: {
    alias: "必须遵循预设结构",
    description: "文档结构与预期大纲不匹配",
  },
  MD044: {
    alias: "专有名词大小写",
    description: "专有名词大小写拼写不规范",
  },
  MD045: {
    alias: "图片缺少替代文本",
    description: "图片必须填写替代文本 (alt text)",
  },
  MD046: {
    alias: "代码块风格统一",
    description: "代码块风格应全篇保持统一",
  },
  MD047: {
    alias: "文件末尾保留换行",
    description: "文件末尾应保留一个换行符",
  },
  MD048: {
    alias: "代码围栏符号统一",
    description: "代码块围栏符号应全篇保持统一",
  },
  MD049: {
    alias: "斜体强调符号统一",
    description: "斜体强调符号应全篇保持统一",
  },
  MD050: {
    alias: "加粗强调符号统一",
    description: "加粗强调符号应全篇保持统一",
  },
  MD051: {
    alias: "内部锚点无效",
    description: "文档内锚点在当前文档中未找到对应标题",
  },
  MD052: {
    alias: "参考链接未定义",
    description: "参考式链接在文档中未找到对应定义",
  },
  MD053: {
    alias: "参考链接定义未使用",
    description: "文档中定义的参考式链接在正文中从未被引用",
  },
  MD054: {
    alias: "链接与图片风格统一",
    description: "内联式与参考式链接风格应在全篇保持一致",
  },
  MD055: {
    alias: "表格竖线风格统一",
    description: "表格外侧竖线（表格边框）格式应保持一致",
  },
  MD056: {
    alias: "表格每行列数一致",
    description: "表格每行的数据单元格数量与表头不一致",
  },
  MD058: {
    alias: "表格四周空行",
    description: "表格上方与下方必须各保留一行空行隔开",
  },
};

/**
 * 常用 markdownlint 规则繁体中文对照词典
 */
export const MARKDOWNLINT_ZH_HANT_RULES: Record<string, LocalizedRuleInfo> = {
  MD001: {
    alias: "標題層級遞增",
    description: "標題層級必須逐級遞增（不可跳躍層級，例如從 H1 直接跳到 H3）",
  },
  MD002: {
    alias: "首個標題為H1",
    description: "文件中的第一個標題必須是一級標題（H1）",
  },
  MD003: {
    alias: "標題風格統一",
    description: "文件內標題風格應保持一致（如統一採用 ATX `#` 風格）",
  },
  MD004: {
    alias: "無序清單符號統一",
    description: "無序清單符號在同一作用域內應保持統一（統一使用 `-`、`*` 或 `+`）",
  },
  MD005: {
    alias: "清單縮排對齊",
    description: "同級清單項目字首縮排必須嚴格對齊",
  },
  MD006: {
    alias: "頂層清單頂格",
    description: "最外層無序清單項目必須從行首起始，不可縮排",
  },
  MD007: {
    alias: "子清單縮排空格",
    description: "子級無序清單縮排空格數量不符合預期",
  },
  MD009: {
    alias: "行尾多餘空格",
    description: "行尾不應存在多餘的空格",
  },
  MD010: {
    alias: "硬制表符縮排",
    description: "請使用空格進行縮排，避免混用硬制表符（Tab）",
  },
  MD011: {
    alias: "反向連結語法",
    description: "連結語法寫反，標準格式為 [連結文字](連結網址)",
  },
  MD012: {
    alias: "連續多個空行",
    description: "段落之間存在多個多餘的連續空白行",
  },
  MD013: {
    alias: "單行字元超長",
    description: "目前行字元長度超過設定上限",
  },
  MD014: {
    alias: "終端命令前綴符號",
    description: "已顯示輸出結果的程式碼區塊中，命令無需新增 $ 字首",
  },
  MD018: {
    alias: "標題缺少空格",
    description: "標題井字號 `#` 與標題正文之間必須保留一個空格",
  },
  MD019: {
    alias: "標題多個空格",
    description: "標題井字號 `#` 與標題正文之間只能保留一個空格，不可包含多個空格",
  },
  MD020: {
    alias: "閉合標題缺少空格",
    description: "閉合式標題（Closed ATX）正文與字首井字號之間缺少空格",
  },
  MD021: {
    alias: "閉合標題多個空格",
    description: "閉合式標題（Closed ATX）正文與前後井字號之間存在多餘空格",
  },
  MD022: {
    alias: "標題四周空行",
    description: "標題上方與下方必須各保留一行空行與正文隔開",
  },
  MD023: {
    alias: "標題必須頂格起始",
    description: "標題必須從行首頂格起始，前面不可包含空格縮排",
  },
  MD024: {
    alias: "重複的標題內容",
    description: "文件中存在多個相同內容的標題，易造成目錄或錨點跳轉歧義",
  },
  MD025: {
    alias: "單一一級主標題",
    description: "一個標準文件通常只應包含一個一級主標題（H1）",
  },
  MD026: {
    alias: "標題末尾多餘標點",
    description: "標題末尾不應包含多餘的標點符號（如句號、逗號、冒號）",
  },
  MD027: {
    alias: "引用塊多個空格",
    description: "引用塊符號 `>` 後面只應保留一個空格",
  },
  MD028: {
    alias: "引用塊空行阻斷",
    description: "引用塊內部不應用純空白行隔斷",
  },
  MD029: {
    alias: "有序清單序號前綴",
    description: "有序清單項目的字首序號必須遞增或保持一致格式",
  },
  MD030: {
    alias: "清單標記空格數量",
    description: "清單符號（`-` 或 `1.`）與文字之間的空格數量不符合預期",
  },
  MD031: {
    alias: "程式碼區塊四周空行",
    description: "圍欄程式碼區塊（```）上方與下方必須各保留一行空行",
  },
  MD032: {
    alias: "清單四周空行",
    description: "清單塊上方與下方必須保留空行與普通段落隔開",
  },
  MD033: {
    alias: "內聯HTML標籤",
    description: "使用了不允許的內聯 HTML 標籤",
  },
  MD034: {
    alias: "裸寫URL",
    description: "偵測到未用尖括號 `<https://...>` 或超連結語法 `[文字](URL)` 包裹的裸寫 URL",
  },
  MD035: {
    alias: "分隔線風格統一",
    description: "水平分隔線符號（如 `---` 或 `***`）應在全篇保持統一",
  },
  MD036: {
    alias: "粗體/斜體濫充標題",
    description: "請使用標準標題語法（`#`），不要使用單行粗體或斜體充當假標題",
  },
  MD037: {
    alias: "粗體/斜體內側多餘空格",
    description: "粗體/斜體標記符號與文字內側不應有多餘空格",
  },
  MD038: {
    alias: "行內程式碼內側多餘空格",
    description: "行內程式碼反引號與程式碼文字內側不應有多餘空格",
  },
  MD039: {
    alias: "連結文字內側多餘空格",
    description: "連結中括號 `[ ... ]` 內側不應有多餘空格",
  },
  MD040: {
    alias: "程式碼區塊未指定語言",
    description: "程式碼區塊（```）必須在起始處明確指定語言識別碼（如 ```ts、```json）",
  },
  MD041: {
    alias: "首行必須是標題",
    description: "文件的第一行應當是一級標題",
  },
  MD042: {
    alias: "空連結",
    description: "連結的目標網址不能為空（如 `[]( )` 或 `[文字]()`）",
  },
  MD043: {
    alias: "必須遵循預設結構",
    description: "文件結構不符合設定中預設的必選標題大綱結構",
  },
  MD044: {
    alias: "專有名詞大小寫",
    description: "專有名詞的大小寫拼寫不符合詞典規範",
  },
  MD045: {
    alias: "圖片缺少替代文字",
    description: "圖片必須填寫描述性替代文字（alt text），以保證無障礙可存取性",
  },
  MD046: {
    alias: "程式碼區塊風格統一",
    description: "程式碼區塊風格（縮排式 vs 圍欄式 ```）應在全篇保持統一",
  },
  MD047: {
    alias: "檔案末尾保留換行",
    description: "檔案末尾應保留一個單獨的換行符",
  },
  MD048: {
    alias: "程式碼圍欄符號統一",
    description: "程式碼區塊圍欄符號（``` 與 ~~~）應在全篇保持統一",
  },
  MD049: {
    alias: "斜體強調符號統一",
    description: "斜體強調符號（`*` 與 `_`）應在全篇保持統一",
  },
  MD050: {
    alias: "粗體強調符號統一",
    description: "粗體強調符號（`**` 與 `__`）應在全篇保持統一",
  },
  MD051: {
    alias: "內部錨點無效",
    description: "文件內的錨點跳轉連結（#hash）在目前文件中未找到對應標題",
  },
  MD052: {
    alias: "參考連結未定義",
    description: "引用的參考式連結或圖片標籤在文件中未找到對應定義",
  },
  MD053: {
    alias: "參考連結定義未使用",
    description: "文件中定義的參考式連結在正文中從未被引用",
  },
  MD054: {
    alias: "連結與圖片風格統一",
    description: "內聯式與參考式連結風格應在全篇保持一致",
  },
  MD055: {
    alias: "表格豎線風格統一",
    description: "表格外側豎線（表格邊框）格式應保持一致",
  },
  MD056: {
    alias: "表格每行列數一致",
    description: "表格每行的資料單元格數量與表頭不一致",
  },
  MD058: {
    alias: "表格四周空行",
    description: "表格上方與下方必須各保留一行空行隔開",
  },
};
