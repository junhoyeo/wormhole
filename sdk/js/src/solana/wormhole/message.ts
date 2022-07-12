import { PublicKey, PublicKeyInitData } from "@solana/web3.js";

export class MessageData {
  vaaVersion: number;
  consistencyLevel: number;
  vaaTime: number;
  vaaSignatureAccount: PublicKey;
  submissionTime: number;
  nonce: number;
  sequence: bigint;
  emitterChain: number;
  emitterAddress: Buffer;
  payload: Buffer;

  static validPrefixes = ["vaa", "msg", "msu"];

  constructor(
    vaaVersion: number,
    consistencyLevel: number,
    vaaTime: number,
    vaaSignatureAccount: PublicKeyInitData,
    submissionTime: number,
    nonce: number,
    sequence: bigint,
    emitterChain: number,
    emitterAddress: Buffer,
    payload: Buffer
  ) {
    this.vaaVersion = vaaVersion;
    this.consistencyLevel = consistencyLevel;
    this.vaaTime = vaaTime;
    this.vaaSignatureAccount = new PublicKey(vaaSignatureAccount);
    this.submissionTime = submissionTime;
    this.nonce = nonce;
    this.sequence = sequence;
    this.emitterChain = emitterChain;
    this.emitterAddress = emitterAddress;
    this.payload = payload;
  }

  static deserialize(data: Buffer): MessageData {
    const prefix = data.subarray(0, 3).toString();
    if (!MessageData.validPrefixes.includes(prefix)) {
      throw Error("prefix mismatch");
    }

    const vaaVersion = data.readUInt8(3);
    const consistencyLevel = data.readUInt8(4);
    const vaaTime = data.readUInt32LE(5);
    const vaaSignatureAccount = new PublicKey(data.subarray(9, 41));
    const submissionTime = data.readUInt32LE(41);
    const nonce = data.readUInt32LE(45);
    const sequence = data.readBigUInt64LE(49);
    const emitterChain = data.readUInt16LE(57);
    const emitterAddress = data.subarray(59, 91);
    // unnecessary to get Vec<u8> length, but being explicit in borsh deserialization
    const payloadLen = data.readUInt32LE(91);
    const payload = data.subarray(95, 95 + payloadLen);

    return new MessageData(
      vaaVersion,
      consistencyLevel,
      vaaTime,
      vaaSignatureAccount,
      submissionTime,
      nonce,
      sequence,
      emitterChain,
      emitterAddress,
      payload
    );
  }
}
