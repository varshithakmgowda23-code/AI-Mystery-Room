import { env } from '../../config/env.js';
import { LocalStorageDriver } from './local.js';

export interface StoredMedia {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

export interface StorageDriver {
  save(bytes: Buffer, mimeType: string): Promise<string>;
  read(filename: string): Promise<StoredMedia>;
  delete(filename: string): Promise<void>;
}

let driver: StorageDriver | undefined;

export function getStorageDriver(): StorageDriver {
  if (env.STORAGE_DRIVER !== 'local') throw new Error('Only STORAGE_DRIVER=local is available in this milestone.');
  driver ??= new LocalStorageDriver(env.STORAGE_LOCAL_DIR);
  return driver;
}
