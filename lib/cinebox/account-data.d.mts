import type { Title } from "./types";
export type AccountData = {
  favorites: number[];
  playback: Record<string, { assetKey?: string; currentTime: number; progress: number; episodes: Record<string, { assetKey?: string; currentTime: number; progress: number }> }>;
  history: Array<{ titleId: number; viewedAt: number }>;
  viewCounts: Record<string, number>;
  preferences: { autoplayNext: boolean };
};
export function emptyAccountData(): AccountData;
export function addAccountView(data: AccountData, titleId: number, viewedAt?: number): AccountData;
export function overlayAccountData(titles: Title[], data: AccountData): Title[];
