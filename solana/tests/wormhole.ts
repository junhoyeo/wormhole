import { expect } from "chai";
import { readFileSync } from "fs";
import * as web3 from "@solana/web3.js";
import { MockGuardians, MockEthereumEmitter, GovernanceEmitter } from "../../sdk/js/src/utils/mock";
import {
  createPostSignedVaaTransactions,
  createUpgradeGuardianSetInstruction,
} from "../../sdk/js/src/solana/wormhole/program";
import { parseVaa } from "../../sdk/js/src/solana/wormhole/parse";

import {
  CORE_BRIDGE_ADDRESS,
  ETHEREUM_TOKEN_BRIDGE_ADDRESS,
  GOVERNANCE_EMITTER_ADDRESS,
  GUARDIAN_KEYS,
  GUARDIAN_SET_INDEX,
  LOCALHOST,
} from "./helpers/consts";
import { getPostedVaa } from "../../sdk/js/src/solana/wormhole/post-vaa";
import { getGuardianSet } from "../../sdk/js/src/solana/wormhole/guardian-set";

// prepare to remove once all testing is done
// import { setDefaultWasm } from "@certusone/wormhole-sdk";
// setDefaultWasm("node");

describe("Wormhole Core Bridge", () => {
  const connection = new web3.Connection(LOCALHOST);

  const payer = web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync("./keys/solana-devnet.json").toString()))
  );

  // for signing wormhole messages
  const guardians = new MockGuardians(GUARDIAN_SET_INDEX, GUARDIAN_KEYS);

  // for generating governance wormhole messages
  const governance = new GovernanceEmitter(GOVERNANCE_EMITTER_ADDRESS);

  // hijacking the ethereum token bridge address for our fake emitter
  const ethereumWormhole = new MockEthereumEmitter(ETHEREUM_TOKEN_BRIDGE_ADDRESS);

  before("Airdrop SOL", async () => {
    await connection.requestAirdrop(payer.publicKey, 1000 * web3.LAMPORTS_PER_SOL).then(async (signature) => {
      await connection.confirmTransaction(signature);
      return signature;
    });
  });

  describe("Post Signed VAA (One Guardian in Wormhole Network)", () => {
    it("Verify Guardian Signature and Post Message", async () => {
      const message = Buffer.from("All your base are belong to us.");
      const nonce = 0;
      const consistencyLevel = 15;
      const published = ethereumWormhole.publishMessage(nonce, message, consistencyLevel);
      const signedVaa = guardians.addSignatures(published, [0]);
      console.log(`signedVaa: ${signedVaa.toString("base64")}`);

      const { unsignedTransactions, signers } = await createPostSignedVaaTransactions(
        connection,
        CORE_BRIDGE_ADDRESS,
        payer.publicKey,
        signedVaa
      );
      const postVaaTransaction = unsignedTransactions.pop();
      if (postVaaTransaction == undefined) {
        throw Error("postVaaTransaction == undefined");
      }
      for (const transaction of unsignedTransactions) {
        const verifyTx = await web3.sendAndConfirmTransaction(connection, transaction, [payer, ...signers]);
        console.log(`verifySignatures:   ${verifyTx}`);
      }

      const postTx = await web3.sendAndConfirmTransaction(connection, postVaaTransaction, [payer]);
      console.log(`postVaa:          ${postTx}`);

      // verify data
      const parsed = parseVaa(signedVaa);
      const messageData = await getPostedVaa(connection, CORE_BRIDGE_ADDRESS, parsed.hash);

      expect(messageData.consistencyLevel).to.equal(consistencyLevel);
      expect(messageData.consistencyLevel).to.equal(parsed.consistencyLevel);
      expect(messageData.emitterAddress.toString("hex")).to.equal(parsed.emitterAddress);
      expect(messageData.emitterChain).to.equal(parsed.emitterChain);
      expect(messageData.nonce).to.equal(nonce);
      expect(messageData.nonce).to.equal(parsed.nonce);
      expect(Buffer.compare(messageData.payload, message)).to.equal(0);
      expect(Buffer.compare(messageData.payload, parsed.payload)).to.equal(0);
      expect(messageData.sequence).to.equal(parsed.sequence);
      expect(messageData.vaaTime).to.equal(parsed.timestamp);
      expect(messageData.vaaVersion).to.equal(parsed.version);
    });
  });

  describe("Post Signed VAA (19 Guardians in Wormhole Network)", () => {
    it("Upgrade Guardian Set to 19 Guardians", async () => {
      const newGuardianSetIndex = guardians.setIndex + 1;
      const newGuardianSet = guardians.getPublicKeys();
      const message = governance.publishGuardianSetUpgrade(newGuardianSetIndex, newGuardianSet);
      const signedVaa = guardians.addSignatures(message, [0]);
      console.log(`signedVaa: ${signedVaa.toString("base64")}`);

      const { unsignedTransactions, signers } = await createPostSignedVaaTransactions(
        connection,
        CORE_BRIDGE_ADDRESS,
        payer.publicKey,
        signedVaa
      );
      const postVaaTransaction = unsignedTransactions.pop();
      if (postVaaTransaction == undefined) {
        throw Error("postVaaTransaction == undefined");
      }
      for (const transaction of unsignedTransactions) {
        const verifyTx = await web3.sendAndConfirmTransaction(connection, transaction, [payer, ...signers]);
        console.log(`verifySignatures:   ${verifyTx}`);
      }

      const postTx = await web3.sendAndConfirmTransaction(connection, postVaaTransaction, [payer]);
      console.log(`postVaa:          ${postTx}`);

      const parsed = parseVaa(signedVaa);
      const upgradeTx = await web3.sendAndConfirmTransaction(
        connection,
        new web3.Transaction().add(createUpgradeGuardianSetInstruction(CORE_BRIDGE_ADDRESS, payer.publicKey, parsed)),
        [payer]
      );
      console.log(`upgradeGuardianSet: ${upgradeTx}`);

      // update guardian's set index now and verify upgrade
      guardians.updateGuardianSetIndex(newGuardianSetIndex);

      const guardianSetData = await getGuardianSet(connection, CORE_BRIDGE_ADDRESS, newGuardianSetIndex);
      expect(guardianSetData.index).to.equal(newGuardianSetIndex);
      expect(guardianSetData.creationTime).to.equal(parsed.timestamp);
      for (let i = 0; i < newGuardianSet.length; ++i) {
        const key = guardianSetData.keys.at(i);
        if (key == undefined) {
          throw Error("key == undefined");
        }
        const expectedKey = newGuardianSet.at(i);
        if (expectedKey == undefined) {
          throw Error("expectedKey == undefined");
        }
        expect(Buffer.compare(key, expectedKey)).to.equal(0);
      }
    });

    it("Post Message with 13 Signatures", async () => {
      const message = Buffer.from("All your base are belong to us.");
      const nonce = 0;
      const consistencyLevel = 15;
      const published = ethereumWormhole.publishMessage(nonce, message, consistencyLevel);
      const signedVaa = guardians.addSignatures(published, [0, 1, 2, 3, 5, 7, 8, 9, 10, 12, 15, 16, 18]);
      console.log(`signedVaa: ${signedVaa.toString("base64")}`);

      const { unsignedTransactions, signers } = await createPostSignedVaaTransactions(
        connection,
        CORE_BRIDGE_ADDRESS,
        payer.publicKey,
        signedVaa
      );
      const postVaaTransaction = unsignedTransactions.pop();
      if (postVaaTransaction == undefined) {
        throw Error("postVaaTransaction == undefined");
      }
      for (const transaction of unsignedTransactions) {
        const verifyTx = await web3.sendAndConfirmTransaction(connection, transaction, [payer, ...signers]);
        console.log(`verifySignatures:   ${verifyTx}`);
      }

      const postTx = await web3.sendAndConfirmTransaction(connection, postVaaTransaction, [payer]);
      console.log(`postVaa:          ${postTx}`);

      // verify data
      const parsed = parseVaa(signedVaa);
      const messageData = await getPostedVaa(connection, CORE_BRIDGE_ADDRESS, parsed.hash);

      expect(messageData.consistencyLevel).to.equal(consistencyLevel);
      expect(messageData.consistencyLevel).to.equal(parsed.consistencyLevel);
      expect(messageData.emitterAddress.toString("hex")).to.equal(parsed.emitterAddress);
      expect(messageData.emitterChain).to.equal(parsed.emitterChain);
      expect(messageData.nonce).to.equal(nonce);
      expect(messageData.nonce).to.equal(parsed.nonce);
      expect(Buffer.compare(messageData.payload, message)).to.equal(0);
      expect(Buffer.compare(messageData.payload, parsed.payload)).to.equal(0);
      expect(messageData.sequence).to.equal(parsed.sequence);
      expect(messageData.vaaTime).to.equal(parsed.timestamp);
      expect(messageData.vaaVersion).to.equal(parsed.version);
    });

    it("Post Message with 19 Signatures", async () => {
      const message = Buffer.from("All your base are belong to us.");
      const nonce = 0;
      const consistencyLevel = 15;
      const published = ethereumWormhole.publishMessage(nonce, message, consistencyLevel);
      const signedVaa = guardians.addSignatures(published, [...Array(19).keys()]);
      console.log(`signedVaa: ${signedVaa.toString("base64")}`);

      const { unsignedTransactions, signers } = await createPostSignedVaaTransactions(
        connection,
        CORE_BRIDGE_ADDRESS,
        payer.publicKey,
        signedVaa
      );
      const postVaaTransaction = unsignedTransactions.pop();
      if (postVaaTransaction == undefined) {
        throw Error("postVaaTransaction == undefined");
      }
      for (const transaction of unsignedTransactions) {
        const verifyTx = await web3.sendAndConfirmTransaction(connection, transaction, [payer, ...signers]);
        console.log(`verifySignatures:   ${verifyTx}`);
      }

      const postTx = await web3.sendAndConfirmTransaction(connection, postVaaTransaction, [payer]);
      console.log(`postVaa:          ${postTx}`);

      // verify data
      const parsed = parseVaa(signedVaa);
      const messageData = await getPostedVaa(connection, CORE_BRIDGE_ADDRESS, parsed.hash);

      expect(messageData.consistencyLevel).to.equal(consistencyLevel);
      expect(messageData.consistencyLevel).to.equal(parsed.consistencyLevel);
      expect(messageData.emitterAddress.toString("hex")).to.equal(parsed.emitterAddress);
      expect(messageData.emitterChain).to.equal(parsed.emitterChain);
      expect(messageData.nonce).to.equal(nonce);
      expect(messageData.nonce).to.equal(parsed.nonce);
      expect(Buffer.compare(messageData.payload, message)).to.equal(0);
      expect(Buffer.compare(messageData.payload, parsed.payload)).to.equal(0);
      expect(messageData.sequence).to.equal(parsed.sequence);
      expect(messageData.vaaTime).to.equal(parsed.timestamp);
      expect(messageData.vaaVersion).to.equal(parsed.version);
    });
  });
});
