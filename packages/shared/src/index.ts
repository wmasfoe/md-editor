export type Markdown = string;

export interface ResultOk<T> {
  readonly ok: true;
  readonly value: T;
}

export interface ResultErr<E extends string = string> {
  readonly ok: false;
  readonly error: E;
  readonly message: string;
}

export type Result<T, E extends string = string> = ResultOk<T> | ResultErr<E>;

export function ok<T>(value: T): ResultOk<T> {
  return { ok: true, value };
}

export function err<E extends string>(error: E, message: string): ResultErr<E> {
  return { ok: false, error, message };
}

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export {
  EMPTY_HEADING_SLUG,
  createHeadingSlugAllocator,
  headingSlugSource,
  slugifyHeading,
} from "./heading-slug.ts";

/**
 * 可释放句柄。放在 `shared` 而不是契约包：这是跨包通用的最小协议，
 * 让 `core` 这类无 UI 包不必为了一个 3 行类型把 CodeMirror 的 peer 拖进安装图。
 */
export interface Disposable {
  dispose(): void;
}
