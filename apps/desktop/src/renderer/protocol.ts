export type EditorMode = "source" | "wysiwyg";

export interface EditorSnapshot {
  type: "snapshot";
  generation: number;
  revision: number;
  markdown: string;
  from: number;
  to: number;
  composing: boolean;
  mode: EditorMode;
}

export type NativeCommand =
  | { type: "load"; generation: number; markdown: string; readonly: boolean; mdx: boolean }
  | {
      type: "settings";
      theme: "system" | "light" | "dark";
      editor: {
        wysiwygFontSize: number;
        proseFontFamily: string;
        codeFontFamily: string;
        showCodeBlockLineNumbers: boolean;
        showInlineStyleMarkers: boolean;
        enableMarkdownLint: boolean;
      };
    }
  | { type: "readonly"; readonly: boolean }
  | { type: "toggle-mode" }
  | { type: "focus" }
  | { type: "format"; id: string }
  | { type: "seek"; line: number }
  | {
      type: "insert";
      generation: number;
      revision: number;
      from: number;
      to: number;
      text: string;
    };

export type HostMessage =
  | { type: "ready" }
  | { type: "editor-focus" }
  | EditorSnapshot
  | {
      type: "command";
      command:
        | "new"
        | "open"
        | "open-folder"
        | "save"
        | "save-as"
        | "close"
        | "outline"
        | "local-ai"
        | "settings";
    }
  | { type: "link"; url: string }
  | { type: "paste-image" }
  | { type: "insert-result"; applied: boolean };
