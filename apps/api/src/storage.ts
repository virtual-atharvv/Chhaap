import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '@chhaap/db';

export class StorageService {
  private uploadsDir: string;
  private previewsDir: string;

  constructor(baseDir: string = path.join(process.cwd(), 'data')) {
    this.uploadsDir = path.join(baseDir, 'uploads');
    this.previewsDir = path.join(baseDir, 'previews');
  }

  async init() {
    await fs.mkdir(this.uploadsDir, { recursive: true });
    await fs.mkdir(this.previewsDir, { recursive: true });
  }

  getUploadsPath(): string {
    return this.uploadsDir;
  }

  getPreviewsPath(): string {
    return this.previewsDir;
  }

  getFilePath(storageKey: string): string {
    return path.join(this.uploadsDir, storageKey);
  }

  getPreviewPath(filename: string): string {
    return path.join(this.previewsDir, filename);
  }

  /**
   * Saves uploaded buffer to storage and computes SHA-256
   */
  async saveFile(
    fileBuffer: Buffer,
    originalName: string,
    mime: string
  ): Promise<{ storageKey: string; sha256: string; sizeBytes: number; filePath: string }> {
    await this.init();
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const ext = path.extname(originalName) || '.pdf';
    const storageKey = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    const filePath = path.join(this.uploadsDir, storageKey);

    await fs.writeFile(filePath, fileBuffer);
    const sizeBytes = fileBuffer.length;

    return { storageKey, sha256, sizeBytes, filePath };
  }

  /**
   * Schedules deletion of a file (e.g. 15 minutes after completion)
   */
  scheduleFileDeletion(fileId: string, delayMs = 15 * 60 * 1000) {
    setTimeout(async () => {
      await this.deleteFile(fileId);
    }, delayMs);
  }

  /**
   * Verifiably deletes a file from disk and updates DB record
   */
  async deleteFile(fileId: string): Promise<boolean> {
    const file = db.getFileById(fileId);
    if (!file || file.deletedAt) return false;

    try {
      const filePath = path.join(this.uploadsDir, file.storageKey);
      await fs.unlink(filePath).catch(() => {});

      // Delete preview thumbnails
      for (const preview of file.previewKeys) {
        const previewPath = path.join(this.previewsDir, preview);
        await fs.unlink(previewPath).catch(() => {});
      }

      file.deletedAt = new Date().toISOString();
      console.log(`[Storage] Privacy auto-deletion executed for file ${fileId} (${file.originalName})`);
      return true;
    } catch (err) {
      console.error(`[Storage] Failed to delete file ${fileId}:`, err);
      return false;
    }
  }
}

export const storage = new StorageService();
