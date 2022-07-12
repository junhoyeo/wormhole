import {
  Commitment,
  ConfirmOptions,
  Connection,
  PublicKeyInitData,
  RpcResponseAndContext,
  SignatureResult,
  Transaction,
} from "@solana/web3.js";
import {
  signSendAndConfirmTransaction,
  SignTransaction,
  sendAndConfirmTransactionsWithRetry,
} from "./utils/transaction";
import { createPostSignedVaaTransactions } from "./wormhole/program";

export async function postVaaWithRetry(
  connection: Connection,
  signTransaction: SignTransaction,
  wormholeProgramId: PublicKeyInitData,
  payer: PublicKeyInitData,
  vaa: Buffer,
  maxRetries?: number,
  commitment?: Commitment
): Promise<RpcResponseAndContext<SignatureResult>[]> {
  const { unsignedTransactions, signers } = await createPostSignedVaaTransactions(
    connection,
    wormholeProgramId,
    payer,
    vaa,
    commitment
  );

  const signatureSet = signers.pop()!;
  const postVaaTransaction = unsignedTransactions.pop()!;

  const responses = await sendAndConfirmTransactionsWithRetry(
    connection,
    (transaction: Transaction) => {
      transaction.partialSign(signatureSet);
      return signTransaction(transaction);
    },
    payer.toString(),
    unsignedTransactions,
    maxRetries
  );
  //While the signature_set is used to create the final instruction, it doesn't need to sign it.
  responses.push(
    ...(await sendAndConfirmTransactionsWithRetry(
      connection,
      signTransaction,
      payer.toString(),
      [postVaaTransaction],
      maxRetries
    ))
  );
  return responses;
}

export async function postVaa(
  connection: Connection,
  signTransaction: SignTransaction,
  wormholeProgramId: PublicKeyInitData,
  payer: PublicKeyInitData,
  vaa: Buffer,
  options?: ConfirmOptions
): Promise<RpcResponseAndContext<SignatureResult>[]> {
  const { unsignedTransactions, signers } = await createPostSignedVaaTransactions(
    connection,
    wormholeProgramId,
    payer,
    vaa,
    options?.commitment
  );

  const signatureSet = signers.pop()!;
  const postVaaTransaction = unsignedTransactions.pop()!;

  //   const signTransactionWithSignatureSet: SignTransaction = (transaction: Transaction) => {
  //     transaction.partialSign(signatureSet);
  //     return signTransaction(transaction);
  //   };

  //   const responses = [];
  //   for (const transaction of unsignedTransactions) {
  //     responses.push(
  //       await signSendAndConfirmTransaction(connection, payer, signTransactionWithSignatureSet, transaction, options)
  //     );
  //   }

  const responses = await Promise.all(
    unsignedTransactions.map(async (transaction) =>
      signSendAndConfirmTransaction(
        connection,
        payer,
        (transaction: Transaction) => {
          transaction.partialSign(signatureSet);
          return signTransaction(transaction);
        },
        transaction,
        options
      )
    )
  );
  responses.push(await signSendAndConfirmTransaction(connection, payer, signTransaction, postVaaTransaction, options));
  return responses;
}
