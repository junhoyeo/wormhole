import { Connection, Commitment, PublicKey, PublicKeyInitData } from "@solana/web3.js";
import { deriveAddress, getAccountData } from "../utils/account";
import { MessageData } from "./message";
import { ParsedVaa, parseVaa } from "./parse";

export function postedVaaKey(wormholeProgramId: PublicKeyInitData, hash: Buffer): PublicKey {
  return deriveAddress([Buffer.from("PostedVAA"), hash], wormholeProgramId);
}

export async function getPostedVaa(
  connection: Connection,
  wormholeProgramId: PublicKeyInitData,
  hash: Buffer,
  commitment?: Commitment
): Promise<MessageData> {
  return connection
    .getAccountInfo(postedVaaKey(wormholeProgramId, hash), commitment)
    .then((info) => MessageData.deserialize(getAccountData(info)));
}

export class PostVaaData {
  // pub struct PostVAAData {
  //     // Header part
  //     pub version: u8,
  //     pub guardian_set_index: u32,

  //     // Body part
  //     pub timestamp: u32,
  //     pub nonce: u32,
  //     pub emitter_chain: u16,
  //     pub emitter_address: ForeignAddress,
  //     pub sequence: u64,
  //     pub consistency_level: u8,
  //     pub payload: Vec<u8>,
  // }

  version: number;
  guardianSetIndex: number;
  timestamp: number;
  nonce: number;
  emitterChain: number;
  emitterAddress: Buffer;
  sequence: bigint;
  consistencyLevel: number;
  payload: Buffer;

  constructor(
    version: number,
    guardianSetIndex: number,
    timestamp: number,
    nonce: number,
    emitterChain: number,
    emitterAddress: Buffer,
    sequence: bigint,
    consistencyLevel: number,
    payload: Buffer
  ) {
    this.version = version;
    this.guardianSetIndex = guardianSetIndex;
    this.timestamp = timestamp;
    this.nonce = nonce;
    this.emitterChain = emitterChain;
    this.emitterAddress = emitterAddress;
    this.sequence = sequence;
    this.consistencyLevel = consistencyLevel;
    this.payload = payload;
  }

  static serialize(
    version: number,
    guardianSetIndex: number,
    timestamp: number,
    nonce: number,
    emitterChain: number,
    emitterAddress: Buffer,
    sequence: bigint,
    consistencyLevel: number,
    payload: Buffer
  ): Buffer {
    const serialized = Buffer.alloc(60 + payload.length);
    serialized.writeUInt8(version, 0);
    serialized.writeUInt32LE(guardianSetIndex, 1);
    serialized.writeUInt32LE(timestamp, 5);
    serialized.writeUInt32LE(nonce, 9);
    serialized.writeUInt16LE(emitterChain, 13);
    serialized.write(emitterAddress.toString("hex"), 15, "hex");
    serialized.writeBigInt64LE(sequence, 47);
    serialized.writeUInt8(consistencyLevel, 55);
    serialized.writeUInt32LE(payload.length, 56);
    serialized.write(payload.toString("hex"), 60, "hex");

    return serialized;
  }

  serialize(): Buffer {
    return PostVaaData.serialize(
      this.version,
      this.guardianSetIndex,
      this.timestamp,
      this.nonce,
      this.emitterChain,
      this.emitterAddress,
      this.sequence,
      this.consistencyLevel,
      this.payload
    );
  }

  static from(parsed: ParsedVaa): PostVaaData {
    return new PostVaaData(
      parsed.version,
      parsed.guardianSetIndex,
      parsed.timestamp,
      parsed.nonce,
      parsed.emitterChain,
      Buffer.from(parsed.emitterAddress, "hex"),
      parsed.sequence,
      parsed.consistencyLevel,
      parsed.payload
    );
  }

  static fromSignedVaa(signedVaa: Buffer): PostVaaData {
    const parsed = parseVaa(signedVaa);
    return PostVaaData.from(parsed);
  }
}
