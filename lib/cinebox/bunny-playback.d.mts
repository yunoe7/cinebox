export type BunnyTimeUpdate = { seconds: number; duration: number };
export type BunnyPlaybackProgress = { second: number; progress: number };
export function isBunnyEmbedUrl(value: unknown): boolean;
export function withBunnyResume(value: string, seconds: number): string;
export function bunnyTimeUpdate(payload: unknown): BunnyTimeUpdate | null;
export function bunnyPlaybackProgress(seconds: number, duration: number): BunnyPlaybackProgress | null;
