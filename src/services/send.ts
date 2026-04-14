import { config } from '../config';
import type { Asset } from '../types';
import type { Connection, VersionedTransaction } from '@solana/web3.js';

type SendableWallet = {
  sendTransaction?: (
    transaction: VersionedTransaction,
    connection: Connection,
    options?: {
      skipPreflight?: boolean;
      maxRetries?: number;
    },
  ) => Promise<string>;
};

function toAtomicAmount(value: string, decimals: number) {
  const normalized = value.trim().replace(/,/g, '');
  if (!normalized || normalized === '.') {
    return 0n;
  }

  const [wholePart = '0', fractionalPart = ''] = normalized.split('.');
  const whole = wholePart.replace(/\D/g, '') || '0';
  const fractional = fractionalPart.replace(/\D/g, '').slice(0, decimals).padEnd(decimals, '0');

  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fractional || '0');
}

async function getMintMetadata(connection: Connection, asset: Asset) {
  const { PublicKey } = await import('@solana/web3.js');
  const { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } = await import('@solana/spl-token');

  if (!asset.tokenAddress) {
    throw new Error('Token metadata is incomplete for this asset.');
  }

  const mint = new PublicKey(asset.tokenAddress);
  const [mintAccount, parsedMintAccount] = await Promise.all([
    connection.getAccountInfo(mint),
    connection.getParsedAccountInfo(mint),
  ]);

  if (!mintAccount) {
    throw new Error(`Unable to find the ${asset.symbol} mint on Solana.`);
  }

  const decimals =
    asset.tokenDecimals ??
    ((parsedMintAccount.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined)?.parsed?.info
      ?.decimals ?? 0);

  return {
    mint,
    decimals,
    programId: mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
  };
}

export async function sendWalletAsset({
  walletAddress,
  wallet,
  asset,
  recipient,
  amount,
}: {
  walletAddress: string;
  wallet: SendableWallet;
  asset: Asset;
  recipient: string;
  amount: string;
}) {
  const { Connection, PublicKey, SystemProgram } = await import('@solana/web3.js');
  const { VersionedTransaction, TransactionMessage } = await import('@solana/web3.js');
  const {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createTransferCheckedInstruction,
    getAssociatedTokenAddressSync,
  } = await import('@solana/spl-token');

  if (!wallet.sendTransaction) {
    throw new Error('Your Privy Solana wallet cannot send transactions yet.');
  }

  const sendTransaction = wallet.sendTransaction;

  const connection = new Connection(config.heliusRpcUrl, 'confirmed');
  const senderPublicKey = new PublicKey(walletAddress);
  const recipientPublicKey = new PublicKey(recipient);
  async function buildTransaction() {
    const instructions = [];

    if (asset.symbol === 'SOL') {
      const lamports = Number(toAtomicAmount(amount, 9));
      const balanceLamports = await connection.getBalance(senderPublicKey, 'confirmed');
      const feeReserveLamports = 10_000;

      if (!Number.isFinite(lamports) || lamports <= 0) {
        throw new Error('Enter a valid SOL amount to send.');
      }

      if (lamports + feeReserveLamports > balanceLamports) {
        throw new Error('Leave a small SOL balance for network fees before sending your full position.');
      }

      instructions.push(
        SystemProgram.transfer({
          fromPubkey: senderPublicKey,
          toPubkey: recipientPublicKey,
          lamports,
        }),
      );
    } else {
      const { mint, decimals, programId } = await getMintMetadata(connection, asset);
      const senderTokenAccount = getAssociatedTokenAddressSync(
        mint,
        senderPublicKey,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const recipientTokenAccount = getAssociatedTokenAddressSync(
        mint,
        recipientPublicKey,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const senderTokenAccountInfo = await connection.getAccountInfo(senderTokenAccount);

      if (!senderTokenAccountInfo) {
        throw new Error(`Your wallet does not have a ${asset.symbol} token account yet.`);
      }

      const recipientTokenAccountInfo = await connection.getAccountInfo(recipientTokenAccount);

      if (!recipientTokenAccountInfo) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            senderPublicKey,
            recipientTokenAccount,
            recipientPublicKey,
            mint,
            programId,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        );
      }

      instructions.push(
        createTransferCheckedInstruction(
          senderTokenAccount,
          mint,
          recipientTokenAccount,
          senderPublicKey,
          toAtomicAmount(amount, decimals),
          decimals,
          [],
          programId,
        ),
      );
    }

    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: senderPublicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions,
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);

    return { transaction, latestBlockhash };
  }

  async function submitWithFreshBlockhash() {
    const { transaction, latestBlockhash } = await buildTransaction();
    const signature = await sendTransaction(transaction, connection, {
      skipPreflight: false,
      maxRetries: 2,
    });

    await connection.confirmTransaction(
      {
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      'confirmed',
    );

    return signature;
  }

  let signature: string;

  try {
    signature = await submitWithFreshBlockhash();
  } catch (error) {
    if (!(error instanceof Error) || !/blockhash not found/i.test(error.message)) {
      throw error;
    }

    signature = await submitWithFreshBlockhash();
  }

  return { signature };
}
