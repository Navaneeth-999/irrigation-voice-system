import fs from 'fs';
import path from 'path';
import { StorageProvider } from './StorageProvider.js';
import { config } from '../../config/index.js';

export class LocalStorageAdapter implements StorageProvider {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = path.resolve(process.cwd(), baseDir || config.STORAGE_LOCAL_DIR);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async upload(bucket: string, filePath: string, content: Buffer | Uint8Array, _contentType?: string): Promise<string> {
    const bucketDir = path.join(this.baseDir, bucket);
    const targetPath = path.join(bucketDir, filePath);
    const targetDir = path.dirname(targetPath);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    await fs.promises.writeFile(targetPath, Buffer.from(content));
    return `${bucket}/${filePath}`;
  }

  async getSignedUrl(bucket: string, filePath: string, _expiresInSeconds = 3600): Promise<string> {
    // For local dev, expose through the local static / storage endpoint
    return `${config.PUBLIC_BASE_URL}/storage/${bucket}/${filePath}`;
  }

  getPublicUrl(bucket: string, filePath: string): string {
    return `${config.PUBLIC_BASE_URL}/storage/${bucket}/${filePath}`;
  }

  async delete(bucket: string, filePath: string): Promise<void> {
    const targetPath = path.join(this.baseDir, bucket, filePath);
    if (fs.existsSync(targetPath)) {
      await fs.promises.unlink(targetPath);
    }
  }
}
