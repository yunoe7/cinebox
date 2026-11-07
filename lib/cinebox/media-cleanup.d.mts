export type MediaCleanupResult =
  | { status: "completed"; results: Array<{ status: "completed"; jobId: string }> }
  | { status: "incomplete"; results: Array<{ status: "deferred" | "corrupt"; jobId?: string; error?: unknown }> ; error?: unknown }
  | { status: "deferred"; results: []; reason?: string; error?: unknown };

export function withMediaReferencesLock<T>(
  callback: () => T | Promise<T>,
  locks?: { request: (name: string, options: { mode: "exclusive" }, callback: () => T | Promise<T>) => Promise<T> },
): Promise<{ status: "locked"; value: T } | { status: "deferred"; reason: "locks-unavailable" } | { status: "failed"; error: unknown }>;

export function createMediaCleanupJob(keys: string[], operation: string): Promise<unknown | null>;
export function readMediaCleanupJobs(): Promise<unknown[]>;
export function processMediaCleanupJobsLocked(options: {
  readReferencedKeys: () => Promise<Set<string>> | Set<string>;
  deleteAssets: (keys: string[]) => Promise<void>;
}): Promise<MediaCleanupResult>;
export function processMediaCleanupJobs(options: {
  readReferencedKeys: () => Promise<Set<string>> | Set<string>;
  deleteAssets: (keys: string[]) => Promise<void>;
}): Promise<MediaCleanupResult>;
export function publishWithMediaCleanupJournal(options: {
  obsoleteKeys: string[];
  operation: string;
  commitMetadata: () => boolean | Promise<boolean>;
  readReferencedKeys: () => Promise<Set<string>> | Set<string>;
  deleteAssets: (keys: string[]) => Promise<void>;
}): Promise<
  | { status: "committed"; jobId?: string; cleanup: MediaCleanupResult }
  | { status: "cleanup-pending"; jobId: string; cleanup: MediaCleanupResult }
  | { status: "commit-failed"; jobId?: string; error?: unknown }
  | { status: "journal-failed"; error: unknown }
  | { status: "catalog-unavailable"; error: unknown }
  | { status: "deferred"; reason?: string; error?: unknown }
>;
