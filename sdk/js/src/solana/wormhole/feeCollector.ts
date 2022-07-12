import { PublicKey, PublicKeyInitData } from "@solana/web3.js";
import { deriveAddress } from "../utils/account";

export function feeCollectorKey(wormholeProgramId: PublicKeyInitData): PublicKey {
  return deriveAddress([Buffer.from("fee_collector")], wormholeProgramId);
}
