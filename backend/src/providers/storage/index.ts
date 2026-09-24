import { StorageProvider } from './StorageProvider.js';
import { LocalStorageAdapter } from './LocalStorageAdapter.js';
import { SupabaseStorageAdapter } from './SupabaseStorageAdapter.js';
import { config } from '../../config/index.js';

let storageInstance: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!storageInstance) {
    if (config.STORAGE_PROVIDER === 'supabase' && config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY) {
      storageInstance = new SupabaseStorageAdapter();
      console.log('☁️ Storage: Supabase Storage Provider active');
    } else {
      storageInstance = new LocalStorageAdapter();
      console.log('📁 Storage: Local Storage Provider active');
    }
  }
  return storageInstance;
}
