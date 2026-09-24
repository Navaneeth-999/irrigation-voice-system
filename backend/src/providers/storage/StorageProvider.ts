export interface StorageProvider {
  upload(bucket: string, filePath: string, content: Buffer | Uint8Array, contentType?: string): Promise<string>;
  getSignedUrl(bucket: string, filePath: string, expiresInSeconds?: number): Promise<string>;
  getPublicUrl(bucket: string, filePath: string): string;
  delete(bucket: string, filePath: string): Promise<void>;
}
