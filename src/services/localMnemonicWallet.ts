import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

type SendTransactionOptions = {
  skipPreflight?: boolean;
  maxRetries?: number;
};

type StoredMnemonicWalletPayload = {
  mnemonic: string;
  privateKey: string;
};

export type ActiveMnemonicWallet = {
  address: string;
  source: 'mnemonic';
  sendTransaction: (
    transaction: import('@solana/web3.js').VersionedTransaction,
    connection: import('@solana/web3.js').Connection,
    options?: SendTransactionOptions,
  ) => Promise<string>;
};

type EncryptedMnemonicWallet = {
  version: 1;
  address: string;
  ciphertext: string;
  iv: string;
  salt: string;
};

const PBKDF2_ITERATIONS = 250_000;
const STORAGE_PREFIX = 'rwa-wallet-mnemonic';

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function toBufferView(bytes: Uint8Array) {
  return Uint8Array.from(bytes);
}

async function deriveEncryptionKey(password: string, salt: Uint8Array) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toBufferView(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function getMnemonicWalletStorageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId}`;
}

export function createActiveMnemonicWallet(privateKey: string): ActiveMnemonicWallet {
  const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));

  return {
    address: keypair.publicKey.toBase58(),
    source: 'mnemonic',
    async sendTransaction(transaction, connection, options) {
      transaction.sign([keypair]);

      return connection.sendTransaction(transaction, {
        skipPreflight: options?.skipPreflight,
        maxRetries: options?.maxRetries,
      });
    },
  };
}

export async function encryptMnemonicWallet(
  payload: StoredMnemonicWalletPayload,
  password: string,
): Promise<EncryptedMnemonicWallet> {
  if (password.trim().length < 8) {
    throw new Error('Use at least 8 characters to protect this device.');
  }

  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(payload)),
  );

  return {
    version: 1,
    address: createActiveMnemonicWallet(payload.privateKey).address,
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
  };
}

export async function decryptMnemonicWallet(
  stored: EncryptedMnemonicWallet,
  password: string,
): Promise<StoredMnemonicWalletPayload> {
  const key = await deriveEncryptionKey(password, base64ToBytes(stored.salt));
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBufferView(base64ToBytes(stored.iv)) },
    key,
    toBufferView(base64ToBytes(stored.ciphertext)),
  );

  return JSON.parse(new TextDecoder().decode(decrypted)) as StoredMnemonicWalletPayload;
}

export function readStoredMnemonicWallet(userId: string) {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(getMnemonicWalletStorageKey(userId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as EncryptedMnemonicWallet;
    if (parsed.version !== 1) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredMnemonicWallet(userId: string, wallet: EncryptedMnemonicWallet) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(getMnemonicWalletStorageKey(userId), JSON.stringify(wallet));
}

export function clearStoredMnemonicWallet(userId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(getMnemonicWalletStorageKey(userId));
}
