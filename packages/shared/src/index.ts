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
