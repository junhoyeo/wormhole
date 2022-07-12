import { PublicKey, PublicKeyInitData } from "@solana/web3.js";
import { deriveAddress } from "../utils/account";

export interface EmitterAccounts {
  emitter: PublicKey;
  sequence: PublicKey;
}

export function emitterKey(programId: PublicKeyInitData): PublicKey {
  return deriveAddress([Buffer.from("emitter")], programId);
}

export function emitterSequenceKey(emitter: PublicKeyInitData, wormholeProgramId: PublicKeyInitData): PublicKey {
  return deriveAddress([Buffer.from("Sequence"), new PublicKey(emitter).toBytes()], wormholeProgramId);
}

export function getEmitterKeys(programId: PublicKeyInitData, wormholeProgramId: PublicKeyInitData): EmitterAccounts {
  const emitter = emitterKey(programId);
  return {
    emitter,
    sequence: emitterSequenceKey(emitter, wormholeProgramId),
  };
}
