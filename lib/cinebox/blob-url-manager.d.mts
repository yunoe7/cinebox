export type BlobUrlLease = { url: string; release: () => void };
export type ProvisionalBlobUrlBatch = {
  create: (blob: Blob) => string;
  readonly urls: string[];
  transferTo: (ownerId: string) => boolean;
  release: () => void;
};
export function createBlobUrlLease(blob: Blob): BlobUrlLease;
export function retainBlobUrl(url: string): BlobUrlLease;
export function createProvisionalBlobUrlBatch(): ProvisionalBlobUrlBatch;
export function syncBlobUrlOwner(ownerId: string, urls: Iterable<string>): void;
export function clearBlobUrlOwner(ownerId: string): void;
