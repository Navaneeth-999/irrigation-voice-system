import { StorageProvider } from './StorageProvider.js';
import { config } from '../../config/index.js';

export class SupabaseStorageAdapter implements StorageProvider {
  private supabaseUrl: string;
  private serviceRoleKey: string;

  constructor() {
    this.supabaseUrl = config.SUPABASE_URL || '';
    this.serviceRoleKey = config.SUPABASE_SERVICE_ROLE_KEY || '';
  }

  async upload(bucket: string, filePath: string, content: Buffer | Uint8Array, contentType = 'application/octet-stream'): Promise<string> {
    const url = `${this.supabaseUrl}/storage/v1/object/${bucket}/${filePath}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.serviceRoleKey}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: content as any,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase upload failed: ${err}`);
    }

    return `${bucket}/${filePath}`;
  }

  async getSignedUrl(bucket: string, filePath: string, expiresInSeconds = 3600): Promise<string> {
    const url = `${this.supabaseUrl}/storage/v1/object/sign/${bucket}/${filePath}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase signed URL failed: ${err}`);
    }

    const data = await res.json() as { signedURL: string };
    return `${this.supabaseUrl}/storage/v1${data.signedURL}`;
  }

  getPublicUrl(bucket: string, filePath: string): string {
    return `${this.supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
  }

  async delete(bucket: string, filePath: string): Promise<void> {
    const url = `${this.supabaseUrl}/storage/v1/object/${bucket}`;
    await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: [filePath] }),
    });
  }
}
