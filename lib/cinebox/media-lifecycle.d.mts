export type StagedAssets =
  | { status: "ready"; references: Record<string, string> }
  | { status: "failed"; references: Record<string, string>; error: unknown };

export function stageAssets(
  assets: Array<{ slot: string; baseKey: string; blob: Blob }>,
  saveVersionedAsset: (baseKey: string, blob: Blob) => Promise<string>,
): Promise<StagedAssets>;

export type MetadataCleanupResult =
  | { status: "commit-failed"; error?: unknown }
  | { status: "committed"; retiredKeys: string[] }
  | { status: "cleanup-failed"; retiredKeys: string[]; error: unknown };

export function commitMetadataThenCleanup(options: {
  commitMetadata: () => boolean | Promise<boolean>;
  obsoleteKeys: string[];
  referencedKeys: Set<string>;
  deleteAssets: (keys: string[]) => Promise<void>;
}): Promise<MetadataCleanupResult>;
