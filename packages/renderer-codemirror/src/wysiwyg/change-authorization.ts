import { Annotation, type EditorState, type StateCommand } from "@codemirror/state";

export const authorizeWysiwygProtectedChange = Annotation.define<boolean>();

const structuredCommandAuthorizationDepth = new WeakMap<EditorState, number>();

export function authorizeWysiwygStructuredCommand(command: StateCommand): StateCommand {
  return (target) => {
    const depth = structuredCommandAuthorizationDepth.get(target.state) ?? 0;
    structuredCommandAuthorizationDepth.set(target.state, depth + 1);
    try {
      // Upstream Markdown commands construct their transaction before dispatch,
      // so authorization must be scoped around their synchronous state.update call.
      return command(target);
    } finally {
      if (depth === 0) {
        structuredCommandAuthorizationDepth.delete(target.state);
      } else {
        structuredCommandAuthorizationDepth.set(target.state, depth);
      }
    }
  };
}

export function isWysiwygStructuredCommandAuthorized(state: EditorState): boolean {
  return structuredCommandAuthorizationDepth.has(state);
}
