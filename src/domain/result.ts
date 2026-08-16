export type Ok<T> = Readonly<{
  ok: true;
  value: T;
}>;

export type Err<E> = Readonly<{
  ok: false;
  error: E;
}>;

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return Object.freeze({ ok: true, value });
}

export function err<E>(error: E): Err<E> {
  return Object.freeze({ ok: false, error });
}
