import {
  Transaction,
  Keypair,
  Connection,
  PublicKeyInitData,
  PublicKey,
  ConfirmOptions,
  RpcResponseAndContext,
  SignatureResult,
} from "@solana/web3.js";

/**
 * Object that holds list of unsigned {@link Transaction}s and {@link Keypair}s
 * required to sign for each transaction.
 */
export interface PreparedTransactions {
  unsignedTransactions: Transaction[];
  signers: Keypair[];
}

/**
 * Resembles WalletContextState's signTransaction function signature
 */
export type SignTransaction = (transaction: Transaction) => Promise<Transaction>;

/**
 * The transactions provided to this function should be ready to send.
 * This function will do the following:
 * 1. Add the {@param payer} as the feePayer and latest blockhash to the {@link Transaction}.
 * 2. Sign using {@param signTransaction}.
 * 3. Send raw transaction.
 * 4. Confirm transaction.
 */
export async function signSendAndConfirmTransaction(
  connection: Connection,
  payer: PublicKeyInitData,
  signTransaction: SignTransaction,
  unsignedTransaction: Transaction,
  options?: ConfirmOptions
): Promise<RpcResponseAndContext<SignatureResult>> {
  const commitment = options?.commitment;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(commitment);
  unsignedTransaction.recentBlockhash = blockhash;
  unsignedTransaction.feePayer = new PublicKey(payer);

  // Sign transaction, broadcast, and confirm
  const signed = await signTransaction(unsignedTransaction);
  return connection.sendRawTransaction(signed.serialize(), options).then((signature) =>
    connection.confirmTransaction(
      {
        blockhash,
        lastValidBlockHeight,
        signature,
      },
      commitment
    )
  );
}

/**
 * @deprecated Please use {@link signSendAndConfirmTransaction} instead, which allows
 * retries to be configured in {@link ConfirmOptions}.
 *
 * The transactions provided to this function should be ready to send.
 * This function will do the following:
 * 1. Add the {@param payer} as the feePayer and latest blockhash to the {@link Transaction}.
 * 2. Sign using {@param signTransaction}.
 * 3. Send raw transaction.
 * 4. Confirm transaction.
 */
export async function sendAndConfirmTransactionsWithRetry(
  connection: Connection,
  signTransaction: SignTransaction,
  payer: string,
  unsignedTransactions: Transaction[],
  maxRetries: number = 0,
  options?: ConfirmOptions
): Promise<RpcResponseAndContext<SignatureResult>[]> {
  if (unsignedTransactions.length == 0) {
    return Promise.reject("No transactions provided to send.");
  }

  const commitment = options?.commitment;

  let currentRetries = 0;
  const responses = [];
  for (const transaction of unsignedTransactions) {
    while (currentRetries <= maxRetries) {
      try {
        const latest = await connection.getLatestBlockhash(commitment);
        transaction.recentBlockhash = latest.blockhash;
        transaction.feePayer = new PublicKey(payer);

        const signed = await signTransaction(transaction).catch((e) => null);
        if (signed == null) {
          return Promise.reject("Failed to sign transaction.");
        }

        responses.push(
          await connection.sendRawTransaction(signed.serialize(), options).then(async (signature) =>
            connection.confirmTransaction(
              {
                signature,
                ...latest,
              },
              commitment
            )
          )
        );
        break;
      } catch (e) {
        console.error(e);
        ++currentRetries;
      }
    }
    if (currentRetries > maxRetries) {
      return Promise.reject("Reached the maximum number of retries.");
    }
  }

  return Promise.resolve(responses);
}
