import {
  AccountMeta,
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  PublicKeyInitData,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  TransactionSignature,
} from "@solana/web3.js";
import * as byteify from "byteify";
import { newAccountMeta, newReadOnlyAccountMeta } from "../utils/account";
import { createSecp256k1Instruction } from "../utils/secp256k1";
import { getGuardianSet, guardianSetKey } from "./guardianSet";
import { postedVaaKey, PostVaaData } from "./postVaa";
import { isBytes, ParsedVaa, parseVaa, SignedVaa } from "./parse";
import { bridgeDataKey, getBridgeData } from "./bridgeConfig";
import { claimKey } from "./claim";
import { getEmitterKeys } from "./emitter";
import { PreparedTransactions } from "../utils/transaction";
import { feeCollectorKey } from "./feeCollector";

const MAX_LEN_GUARDIAN_KEYS = 19;

/** Solitaire enum of existing the Core Bridge's instructions.
 *
 * https://github.com/certusone/wormhole/blob/dev.v2/solana/bridge/program/src/lib.rs#L92
 */
export enum WormholeInstruction {
  Initialize,
  PostMessage,
  PostVAA,
  SetFees,
  TransferFees,
  UpgradeContract,
  UpgradeGuardianSet,
  VerifySignatures,
  PostMessageUnreliable, // sounds useful
}

/** All accounts required to make a cross-program invocation with the Core Bridge program */
export interface WormholeCpiAccounts {
  emitter: PublicKey;
  sequence: PublicKey;
  config: PublicKey;
  feeCollector: PublicKey;
  message: PublicKey;
}

/**
 * This is used in {@link createPostSignedVaaTransactions}'s initial transactions.
 *
 * Signatures are batched in groups of 7 due to instruction
 * data limits. These signatures are passed through to the Secp256k1
 * program to verify that the guardian public keys can be recovered.
 * This instruction is paired with `verify_signatures` to validate the
 * pubkey recovery.
 *
 * There are at most three pairs of instructions created.
 *
 * https://github.com/certusone/wormhole/blob/dev.v2/solana/bridge/program/src/api/verify_signature.rs
 *
 *
 * @param {Connection} connection - Solana web3 connection
 * @param {PublicKeyInitData} wormholeProgramId - wormhole program address
 * @param {PublicKeyInitData} payer - transaction signer address
 * @param {SignedVaa | ParsedVaa} vaa - either signed VAA bytes or parsed VAA (use {@link parseVaa} on signed VAA)
 * @param {PublicKeyInitData} signatureSet - address to account of verified signatures
 * @param {web3.ConfirmOptions} [options] - Solana confirmation options
 */
export async function createVerifySignaturesInstructions(
  connection: Connection,
  wormholeProgramId: PublicKeyInitData,
  payer: PublicKeyInitData,
  vaa: SignedVaa | ParsedVaa,
  signatureSet: PublicKeyInitData,
  commitment?: Commitment
): Promise<TransactionInstruction[]> {
  const parsed = isBytes(vaa) ? parseVaa(vaa) : vaa;
  const guardianSetIndex = parsed.guardianSetIndex;
  const guardianSetData = await getGuardianSet(connection, wormholeProgramId, guardianSetIndex, commitment);

  const guardianSignatures = parsed.guardianSignatures;
  const guardianKeys = guardianSetData.keys;

  const batchSize = 7;
  const instructions: TransactionInstruction[] = [];
  for (let i = 0; i < Math.ceil(guardianSignatures.length / batchSize); ++i) {
    const start = i * batchSize;
    const end = Math.min(guardianSignatures.length, (i + 1) * batchSize);

    const signatureStatus = Buffer.alloc(MAX_LEN_GUARDIAN_KEYS, -1);
    const signatures: Buffer[] = [];
    const keys: Buffer[] = [];
    for (let j = 0; j < end - start; ++j) {
      const item = guardianSignatures.at(j + start);
      if (item == undefined) {
        throw Error("item == undefined");
      }
      signatures.push(item.signature);
      const key = guardianKeys.at(item.index);
      if (key == undefined) {
        throw Error("key == undefined");
      }
      keys.push(key);
      signatureStatus.writeInt8(j, item.index);
    }

    instructions.push(createSecp256k1Instruction(signatures, keys, parsed.hash));
    instructions.push(
      createVerifySignaturesInstruction(wormholeProgramId, payer, parsed, signatureSet, signatureStatus)
    );
  }
  return instructions;
}

/**
 * Make {@link TransactionInstruction} for `verify_signatures` instruction.
 *
 * This is used in {@link createVerifySignaturesInstructions} for each batch of signatures being verified.
 * `signatureSet` is a {@link web3.Keypair} generated outside of this method, used
 * for writing signatures and the message hash to.
 *
 * https://github.com/certusone/wormhole/blob/dev.v2/solana/bridge/program/src/api/verify_signature.rs
 *
 * @param {PublicKeyInitData} wormholeProgramId - wormhole program address
 * @param {PublicKeyInitData} payer - transaction signer address
 * @param {SignedVaa | ParsedVaa} vaa - either signed VAA (Buffer) or parsed VAA (use {@link parseVaa} on signed VAA)
 * @param {PublicKeyInitData} signatureSet - key for signature set account
 * @param {Buffer} signatureStatus - array of guardian indices
 *
 */
function createVerifySignaturesInstruction(
  wormholeProgramId: PublicKeyInitData,
  payer: PublicKeyInitData,
  vaa: SignedVaa | ParsedVaa,
  signatureSet: PublicKeyInitData,
  signatureStatus: Buffer
): TransactionInstruction {
  const parsed = isBytes(vaa) ? parseVaa(vaa) : vaa;
  //   AccountMeta::new(payer, true),
  //   AccountMeta::new_readonly(guardian_set, false),
  //   AccountMeta::new(signature_set, true),
  //   AccountMeta::new_readonly(sysvar::instructions::id(), false),
  //   AccountMeta::new_readonly(sysvar::rent::id(), false),
  //   AccountMeta::new_readonly(solana_program::system_program::id(), false),
  const accounts: AccountMeta[] = [
    newAccountMeta(payer, true),
    newReadOnlyAccountMeta(guardianSetKey(wormholeProgramId, parsed.guardianSetIndex), false),
    newAccountMeta(signatureSet, true),
    newReadOnlyAccountMeta(SYSVAR_INSTRUCTIONS_PUBKEY, false),
    newReadOnlyAccountMeta(SYSVAR_RENT_PUBKEY, false),
    newReadOnlyAccountMeta(SystemProgram.programId, false),
  ];

  return createWormholeInstruction(wormholeProgramId, accounts, WormholeInstruction.VerifySignatures, signatureStatus);
}

/** Make {@link TransactionInstruction} for `post_vaa` instruction.
 *
 * This is used in {@link createPostSignedVaaTransactions}'s last transaction.
 * `signatureSet` is a {@link web3.Keypair} generated outside of this method, which was used
 * to write signatures and the message hash to.
 *
 * https://github.com/certusone/wormhole/blob/dev.v2/solana/bridge/program/src/api/post_vaa.rs
 *
 * @param {PublicKeyInitData} wormholeProgramId - wormhole program address
 * @param {PublicKeyInitData} payer - transaction signer address
 * @param {SignedVaa | ParsedVaa} vaa - either signed VAA bytes or parsed VAA (use {@link parseVaa} on signed VAA)
 * @param {PublicKeyInitData} signatureSet - key for signature set account
 */
export function createPostVaaInstruction(
  wormholeProgramId: PublicKeyInitData,
  payer: PublicKeyInitData,
  vaa: SignedVaa | ParsedVaa,
  signatureSet: PublicKeyInitData
): TransactionInstruction {
  const parsed = isBytes(vaa) ? parseVaa(vaa) : vaa;
  // AccountMeta::new_readonly(guardian_set, false),
  // AccountMeta::new_readonly(bridge, false),
  // AccountMeta::new_readonly(signature_set, false),
  // AccountMeta::new(message, false),
  // AccountMeta::new(payer, true),
  // AccountMeta::new_readonly(sysvar::clock::id(), false),
  // AccountMeta::new_readonly(sysvar::rent::id(), false),
  // AccountMeta::new_readonly(solana_program::system_program::id(), false),
  const accounts: AccountMeta[] = [
    newReadOnlyAccountMeta(guardianSetKey(wormholeProgramId, parsed.guardianSetIndex), false),
    newReadOnlyAccountMeta(bridgeDataKey(wormholeProgramId), false),
    newReadOnlyAccountMeta(signatureSet, false),
    newAccountMeta(postedVaaKey(wormholeProgramId, parsed.hash), false),
    newAccountMeta(payer, true),
    newReadOnlyAccountMeta(SYSVAR_CLOCK_PUBKEY, false),
    newReadOnlyAccountMeta(SYSVAR_RENT_PUBKEY, false),
    newReadOnlyAccountMeta(SystemProgram.programId, false),
  ];

  return createWormholeInstruction(
    wormholeProgramId,
    accounts,
    WormholeInstruction.PostVAA,
    PostVaaData.from(parsed).serialize()
  );
}

/** Send transactions for `verify_signatures` and `post_vaa` instructions.
 *
 * Using a signed VAA, execute transactions generated by {@link verifySignatures} and
 * {@link postVaa}. At most 4 transactions are sent (up to 3 from signature verification
 * and 1 to post VAA data to an account).
 *
 * @param {Connection} connection - Solana web3 connection
 * @param {PublicKeyInitData} wormholeProgramId - wormhole program address
 * @param {web3.Keypair} payer - transaction signer address
 * @param {Buffer} signedVaa - bytes of signed VAA
 * @param {Commitment} [options] - Solana commitment
 *
 */
export async function createPostSignedVaaTransactions(
  connection: Connection,
  wormholeProgramId: PublicKeyInitData,
  payer: PublicKeyInitData,
  vaa: SignedVaa | ParsedVaa,
  commitment?: Commitment
): Promise<PreparedTransactions> {
  const parsed = isBytes(vaa) ? parseVaa(vaa) : vaa;
  const signatureSet = Keypair.generate();

  const verifySignaturesInstructions = await createVerifySignaturesInstructions(
    connection,
    wormholeProgramId,
    payer,
    parsed,
    signatureSet.publicKey,
    commitment
  );

  const unsignedTransactions: Transaction[] = [];
  for (let i = 0; i < verifySignaturesInstructions.length; i += 2) {
    unsignedTransactions.push(new Transaction().add(...verifySignaturesInstructions.slice(i, i + 2)));
  }

  unsignedTransactions.push(
    new Transaction().add(createPostVaaInstruction(wormholeProgramId, payer, parsed, signatureSet.publicKey))
  );

  return {
    unsignedTransactions,
    signers: [signatureSet],
  };
}

export function createUpgradeGuardianSetInstruction(
  wormholeProgramId: PublicKeyInitData,
  payer: PublicKeyInitData,
  vaa: SignedVaa | ParsedVaa
): TransactionInstruction {
  const parsed = isBytes(vaa) ? parseVaa(vaa) : vaa;
  // AccountMeta::new(payer, true),
  // AccountMeta::new(bridge, false),
  // AccountMeta::new_readonly(payload_message, false),
  // AccountMeta::new(claim, false),
  // AccountMeta::new(guardian_set_old, false),
  // AccountMeta::new(guardian_set_new, false),
  // AccountMeta::new_readonly(solana_program::system_program::id(), false),
  const accounts: AccountMeta[] = [
    newAccountMeta(payer, true),
    newAccountMeta(bridgeDataKey(wormholeProgramId), false),
    newReadOnlyAccountMeta(postedVaaKey(wormholeProgramId, parsed.hash), false),
    newAccountMeta(claimKey(wormholeProgramId, parsed.emitterAddress, parsed.emitterChain, parsed.sequence), false),
    newAccountMeta(guardianSetKey(wormholeProgramId, parsed.guardianSetIndex), false),
    newAccountMeta(guardianSetKey(wormholeProgramId, parsed.guardianSetIndex + 1), false),
    newReadOnlyAccountMeta(SystemProgram.programId, false),
  ];

  return createWormholeInstruction(wormholeProgramId, accounts, WormholeInstruction.UpgradeGuardianSet);
}

export async function createBridgeFeeTransferInstruction(
  connection: Connection,
  wormholeProgramId: PublicKeyInitData,
  payer: PublicKeyInitData,
  commitment?: Commitment
): Promise<TransactionInstruction> {
  const fee = await getBridgeData(connection, wormholeProgramId, commitment).then((data) => data.config.fee);
  return SystemProgram.transfer({
    fromPubkey: new PublicKey(payer),
    toPubkey: feeCollectorKey(wormholeProgramId),
    lamports: fee,
  });
}

export function getCpiAccounts(
  wormholeProgramId: PublicKeyInitData,
  emitterProgramId: PublicKeyInitData,
  vaaHash: Buffer
): WormholeCpiAccounts {
  const { emitter, sequence } = getEmitterKeys(emitterProgramId, wormholeProgramId);
  return {
    emitter,
    sequence,
    config: bridgeDataKey(wormholeProgramId),
    feeCollector: feeCollectorKey(wormholeProgramId),
    message: postedVaaKey(wormholeProgramId, vaaHash),
  };
}

function createWormholeInstruction(
  wormholeProgramId: PublicKeyInitData,
  accounts: AccountMeta[],
  instructionType: WormholeInstruction,
  data?: Buffer
): TransactionInstruction {
  return {
    programId: new PublicKey(wormholeProgramId),
    keys: accounts,
    data: Buffer.concat([byteify.serializeUint8(instructionType), data == undefined ? Buffer.alloc(0) : data]),
  };
}
