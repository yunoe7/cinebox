export type LocalJsonRead<T> =
  | { status: "missing" }
  | { status: "valid"; value: T; raw: string }
  | { status: "error"; reason: "access" | "parse" | "invalid"; error: Error };

export type LocalJsonWrite =
  | { ok: true }
  | { ok: false; reason: "quota" | "access" | "serialize"; error: Error };

export function readLocalJson<T>(
  getStorage: () => Pick<Storage, "getItem">,
  key: string,
  validate: (value: unknown) => value is T,
): LocalJsonRead<T>;

export function initialValueFor<T>(result: LocalJsonRead<T>, fallback: T): T;

export function reconcileFavorites(
  titles: LocalJsonRead<Array<{ id: number }>>,
  favorites: LocalJsonRead<number[]>,
): { value: number[]; changed: boolean };

export function writeLocalJson<T>(
  getStorage: () => Pick<Storage, "setItem">,
  key: string,
  value: T,
): LocalJsonWrite;

export function writeLocalJsonPair<TFirst, TSecond>(
  getStorage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">,
  firstKey: string,
  firstValue: TFirst,
  secondKey: string,
  secondValue: TSecond,
): LocalJsonWrite & { rollbackFailed?: boolean };
