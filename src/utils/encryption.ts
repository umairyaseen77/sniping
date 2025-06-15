import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from '@aws-sdk/client-kms';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { config, logger } from '../config';
import { metrics } from './metrics';

const kmsClient = new KMSClient({ region: config.aws.region });

// In-memory cache for decrypted data keys
interface DataKeyCache {
  key: Buffer;
  timestamp: number;
}

const dataKeyCache = new Map<string, DataKeyCache>();
const CACHE_TTL = 3600000; // 1 hour in milliseconds

// Clean up expired cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [keyId, cache] of dataKeyCache.entries()) {
    if (now - cache.timestamp > CACHE_TTL) {
      dataKeyCache.delete(keyId);
      logger.debug({ keyId }, 'Evicted expired data key from cache');
    }
  }
}, 300000); // Run every 5 minutes

export async function generateDataKey(): Promise<{
  plaintext: Buffer;
  ciphertext: Buffer;
}> {
  const command = new GenerateDataKeyCommand({
    KeyId: config.aws.kmsKeyId,
    KeySpec: 'AES_256',
  });

  const response = await kmsClient.send(command);
  
  if (!response.Plaintext || !response.CiphertextBlob) {
    throw new Error('Failed to generate data key');
  }

  return {
    plaintext: Buffer.from(response.Plaintext),
    ciphertext: Buffer.from(response.CiphertextBlob),
  };
}

export async function decryptDataKey(encryptedKey: Buffer): Promise<Buffer> {
  const keyId = encryptedKey.toString('base64');
  
  // Check cache first
  const cached = dataKeyCache.get(keyId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    metrics.kmsCacheHits.inc();
    return cached.key;
  }
  
  metrics.kmsCacheMisses.inc();
  
  const command = new DecryptCommand({
    CiphertextBlob: encryptedKey,
  });

  const response = await kmsClient.send(command);
  
  if (!response.Plaintext) {
    throw new Error('Failed to decrypt data key');
  }

  const plaintext = Buffer.from(response.Plaintext);
  
  // Update cache
  dataKeyCache.set(keyId, {
    key: plaintext,
    timestamp: Date.now(),
  });

  return plaintext;
}

export function encrypt(plaintext: string | Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);
  
  const authTag = cipher.getAuthTag();
  
  // Combine IV + authTag + encrypted data
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decrypt(ciphertext: Buffer, key: Buffer): Buffer {
  if (ciphertext.length < 32) {
    throw new Error('Invalid ciphertext');
  }
  
  const iv = ciphertext.slice(0, 16);
  const authTag = ciphertext.slice(16, 32);
  const encrypted = ciphertext.slice(32);
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
}

export async function encryptAndSave(
  data: any,
  filePath: string
): Promise<void> {
  try {
    // Generate a new data key for this encryption
    const { plaintext: dataKey, ciphertext: encryptedDataKey } = await generateDataKey();
    
    // Encrypt the data
    const jsonData = JSON.stringify(data);
    const encryptedData = encrypt(jsonData, dataKey);
    
    // Combine encrypted data key and encrypted data
    const payload = {
      version: 1,
      encryptedDataKey: encryptedDataKey.toString('base64'),
      encryptedData: encryptedData.toString('base64'),
      timestamp: new Date().toISOString(),
    };
    
    // Ensure directory exists
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    if (dir) {
      await fs.mkdir(dir, { recursive: true });
    }
    
    // Write to file
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
    
    // Clear the plaintext key from memory
    dataKey.fill(0);
    
    logger.info({ filePath }, 'Successfully encrypted and saved data');
  } catch (error) {
    logger.error({ error, filePath }, 'Failed to encrypt and save data');
    throw error;
  }
}

export async function loadAndDecrypt(filePath: string): Promise<any> {
  try {
    // Read the file
    const fileContent = await fs.readFile(filePath, 'utf8');
    const payload = JSON.parse(fileContent);
    
    if (payload.version !== 1) {
      throw new Error(`Unsupported encryption version: ${payload.version}`);
    }
    
    // Decrypt the data key
    const encryptedDataKey = Buffer.from(payload.encryptedDataKey, 'base64');
    const dataKey = await decryptDataKey(encryptedDataKey);
    
    // Decrypt the data
    const encryptedData = Buffer.from(payload.encryptedData, 'base64');
    const decryptedData = decrypt(encryptedData, dataKey);
    
    // Parse and return the JSON data
    return JSON.parse(decryptedData.toString('utf8'));
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      logger.debug({ filePath }, 'Encrypted file not found');
      return null;
    }
    
    logger.error({ error, filePath }, 'Failed to load and decrypt data');
    throw error;
  }
}

// Helper to securely wipe sensitive data from memory
export function secureWipe(buffer: Buffer): void {
  crypto.randomFillSync(buffer);
  buffer.fill(0);
} 