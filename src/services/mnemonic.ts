import { Keypair } from '@solana/web3.js';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import bs58 from 'bs58';

const HARDENED_OFFSET = 0x80000000;
const SOLANA_DERIVATION_PATH = [44, 501, 0, 0];

function deriveHardenedEd25519Path(seed: Uint8Array, path: number[]) {
  let node = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = node.slice(0, 32);
  let chainCode = node.slice(32);

  for (const index of path) {
    const data = new Uint8Array(1 + 32 + 4);
    const hardenedIndex = index + HARDENED_OFFSET;

    data[0] = 0;
    data.set(key, 1);
    data[33] = (hardenedIndex >>> 24) & 0xff;
    data[34] = (hardenedIndex >>> 16) & 0xff;
    data[35] = (hardenedIndex >>> 8) & 0xff;
    data[36] = hardenedIndex & 0xff;

    node = hmac(sha512, chainCode, data);
    key = node.slice(0, 32);
    chainCode = node.slice(32);
  }

  return key;
}

export type SolanaMnemonicWallet = {
  mnemonic: string;
  address: string;
  privateKey: string;
};

export function createSolanaMnemonicWallet(): SolanaMnemonicWallet {
  const mnemonic = generateMnemonic(wordlist, 256);
  return deriveSolanaMnemonicWallet(mnemonic);
}

export function deriveSolanaMnemonicWallet(mnemonic: string): SolanaMnemonicWallet {
  const normalizedMnemonic = mnemonic.trim().replace(/\s+/g, ' ').toLowerCase();

  if (!validateMnemonic(normalizedMnemonic, wordlist)) {
    throw new Error('Generated recovery phrase is invalid.');
  }

  const seed = mnemonicToSeedSync(normalizedMnemonic);
  const derivedSeed = deriveHardenedEd25519Path(seed, SOLANA_DERIVATION_PATH);
  const keypair = Keypair.fromSeed(derivedSeed);

  return {
    mnemonic: normalizedMnemonic,
    address: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
  };
}
