import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StorageDriver, StoredMedia } from './index.js';

const mimeExtensions: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

export class LocalStorageDriver implements StorageDriver {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = path.resolve(directory);
  }

  async save(bytes: Buffer, mimeType: string): Promise<string> {
    const extension = mimeExtensions[mimeType];
    if (!extension) throw new Error('Unsupported generated image format.');
    const filename = `${randomUUID()}${extension}`;
    await mkdir(this.directory, { recursive: true });
    await writeFile(path.join(this.directory, filename), bytes, { flag: 'wx' });
    return filename;
  }

  async read(filename: string): Promise<StoredMedia> {
    const extension = path.extname(filename).toLowerCase();
    const mimeType = Object.entries(mimeExtensions).find(([, value]) => value === extension)?.[0];
    if (!mimeType || path.basename(filename) !== filename) throw new Error('Invalid stored media filename.');
    const bytes = await readFile(path.join(this.directory, filename));
    return { filename, mimeType, bytes };
  }

  async delete(filename: string): Promise<void> {
    if (path.basename(filename) !== filename || !/^[\da-f-]{36}\.(png|jpg|webp)$/i.test(filename)) return;
    await unlink(path.join(this.directory, filename)).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT') return;
      throw error;
    });
  }
}
