/**
 * Durable file storage abstraction for Garmin activity files (FIT/TCX/GPX).
 *
 * Files are stored under per-user prefixes (`${userId}/${summaryId}.fit`) so
 * that GDPR deletion can wipe everything for a user with a single prefix
 * delete — FIT files contain GPS tracks, so they must be cleaned up
 * explicitly when a user disconnects or deletes their account (DB rows
 * cascade-delete, files do not).
 *
 * Backends:
 * - Local filesystem (default): writes under FIT_STORAGE_DIR (./storage/fit).
 * - S3 (TODO stub): selected when S3_BUCKET + AWS credentials are present.
 */

import { mkdir, readFile, writeFile, unlink, rm } from "fs/promises";
import path from "path";

// ─── Interface ──────────────────────────────────────────────────────────────

export interface FileStorage {
  /** Store bytes under `key`. Returns the stored path (backend-specific). */
  put(key: string, bytes: Buffer): Promise<string>;
  /**
   * Read the bytes stored under `key` (or a stored path previously returned
   * by `put`). Returns null when the object does not exist.
   */
  get(key: string): Promise<Buffer | null>;
  /** Delete a single object. Missing objects are not an error. */
  delete(key: string): Promise<void>;
  /** Delete every object under a user's prefix (GDPR cleanup). */
  deleteUserFiles(userIdPrefix: string): Promise<void>;
}

// ─── Key Scheme ─────────────────────────────────────────────────────────────

const FILE_EXTENSIONS: Record<string, string> = {
  FIT: "fit",
  TCX: "tcx",
  GPX: "gpx",
};

/**
 * Sanitize a single key segment: strips path separators and dot-runs so
 * webhook-provided values can never traverse outside the storage root.
 */
function sanitizeSegment(segment: string): string {
  return segment.replace(/[/\\]/g, "_").replace(/\.\.+/g, "_");
}

/**
 * Build the storage key for an activity file: `${userId}/${summaryId}.fit`
 * (extension follows the Garmin fileType; defaults to .fit).
 */
export function buildFitFileKey(
  userId: string,
  summaryId: string,
  fileType = "FIT",
): string {
  const ext = FILE_EXTENSIONS[fileType.toUpperCase()] ?? "fit";
  return `${sanitizeSegment(userId)}/${sanitizeSegment(summaryId)}.${ext}`;
}

// ─── Local Filesystem Backend (default) ─────────────────────────────────────

const DEFAULT_STORAGE_DIR = "./storage/fit";

export class LocalFileStorage implements FileStorage {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = path.resolve(
      baseDir ?? process.env.FIT_STORAGE_DIR ?? DEFAULT_STORAGE_DIR,
    );
  }

  private resolveKey(key: string): string {
    const fullPath = path.resolve(this.baseDir, key);
    // Defense in depth: keys are sanitized at build time, but never allow
    // a resolved path to escape the storage root.
    if (!fullPath.startsWith(this.baseDir + path.sep)) {
      throw new Error(`Storage key escapes base directory: ${key}`);
    }
    return fullPath;
  }

  async put(key: string, bytes: Buffer): Promise<string> {
    const fullPath = this.resolveKey(key);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, bytes);
    return fullPath;
  }

  async get(key: string): Promise<Buffer | null> {
    const fullPath = this.resolveKey(key);
    try {
      return await readFile(fullPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.resolveKey(key);
    try {
      await unlink(fullPath);
    } catch (error) {
      // Missing files are fine — deletion is idempotent
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async deleteUserFiles(userIdPrefix: string): Promise<void> {
    const userDir = this.resolveKey(sanitizeSegment(userIdPrefix));
    await rm(userDir, { recursive: true, force: true });
  }
}

// ─── S3 Backend (TODO stub) ─────────────────────────────────────────────────

/**
 * TODO: Implement with @aws-sdk/client-s3 (PutObject / DeleteObject /
 * ListObjectsV2 + batched DeleteObjects for the user prefix).
 * Selected automatically when S3_BUCKET + AWS credentials are set.
 */
export class S3FileStorage implements FileStorage {
  async put(): Promise<string> {
    throw new Error("S3 storage is not configured");
  }

  async get(): Promise<Buffer | null> {
    throw new Error("S3 storage is not configured");
  }

  async delete(): Promise<void> {
    throw new Error("S3 storage is not configured");
  }

  async deleteUserFiles(): Promise<void> {
    throw new Error("S3 storage is not configured");
  }
}

// ─── Backend Selection ──────────────────────────────────────────────────────

function isS3Configured(): boolean {
  return Boolean(
    process.env.S3_BUCKET &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY,
  );
}

let storageInstance: FileStorage | null = null;

/** Get the configured storage backend (S3 if env vars present, else local). */
export function getStorage(): FileStorage {
  if (!storageInstance) {
    storageInstance = isS3Configured()
      ? new S3FileStorage()
      : new LocalFileStorage();
  }
  return storageInstance;
}
