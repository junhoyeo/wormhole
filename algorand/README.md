Wormhole Support for Algorand
=============================

This directory contains the components needed to support full Wormhole functionality under the Algorand blockchain platform.

## Component overview
---------------------

This system is comprised of the following main components:

* **Core contract ([`wormhole_core.py`](./wormhole_core.py))**: Algorand stateful contract with entrypoints for publishing messages (VAAs), verification of VAA signatures, and triggering of governance chores. This will be referred as _CoreContract_ in this document.

* **Token bridge contract ([`token_bridge.py`](./token_bridge.py))**: Algorand stateful contract supporting cross-chain bridging, exposing entrypoints for exchanging  attestations, native tokens and ASAs, and triggering of governance. This will be referred as _TokenBridge_ in this document.

* **VAA verification stateless program ([`vaa_verify.py`](./vaa_verify.py))**:  Stateless program for verifying the signatures of a Wormhole VAA payload against the set of  active guardian public keys. This will be referred as _VaaVerify_ in this document.

* **Dynamic storage stateless program ([`TmplSig.py`](./TmplSig.py))**: A stateless program that is bound to the main core and token bridge contracts to provide dynamic storage spaces addressable as a raw blob of bytes.  See [`local_blob.py`](./local_blob.py).  This will be referred as _TmplSig_ in this document. 

Helper utilities and code include support PyTEAL code,  deployment tools and tests.

## System Architecture
----------------------

### _TmplSig_ details
--------------------

This stateless program code is parameterized with several values that give different output address.  The stateless code will check for several transaction parameters accordingly.

| Text               | Replaced by                                                                                                                                                                   |
|--------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `TMPL_ADDR_IDX`    | Where storage starts interpreting the space as a raw array of bytes                                                                                                           |
| `TMPL_EMITTER_ID`  | Concatenation of chain Id + emitter Id in VAAs to be processed, or a hardcoded string identifying the type of information stored e.g    `guardian` utf8 string stored in hex. |
| `TMPL_APP_ID`      | Application Id of _CoreContract_, _TokenBridge_, etc that is specified as the **opt-in** target transaction
| `TMPL_APP_ADDRESS` | Escrow address of the stateful contract specified in `APP_ID`. Used for **rekey** target in the transaction


* Local-state associated with the _TmplSig_ accounts are used as dynamic storage. The technique is to access this local storage as a plain array of bytes instead of the typical key/value structure.  With the current Algorand parameters, we have 127 * 15 ~ 2K of storage to be used random-access-like.
* The contract accounts addresses are generated by compilation of a stateless code parameterized by several parameters. In the system, the following contract accounts are generated:
    * Account (`seq_addr`) for storing verified sequence number bits based on `chainId`,`emitter`,`int(vaa.sequence / MAX_BITS)` where MAX_BITS = 15240.  This allows the system to reject duplicated VAAs for the last 2K sequence numbers.
    * Account (`guardian_addr` and `new_guardian_addr`) for storing total guardian count , the guardian public keys and guardian set expiration time.
* Once generated, the accounts are opted-in and rekeyed to the core application.

Briefly, the semantics of the transaction when _TmplSig_ is "attached" to a stateful app is:
1. Optin of LogicSig to target stateful contract `TMPL_APP_ID` for the app to use LogicSig account local storage
2. Rekey of LogicSig to escrow address for the smart contract to become the sole "governor" of the LogicSig account address

> NOTE: A more detailed overview of _TmplSig_ can be found in [MEMORY.md](./MEMORY.md).

## Core Contract: Functional Description
----------------------------------------
### Initialization stage
The initialization call needs a governance VAA to be passed in, typically to setup initial guardian list. The init call will: 
* store the _VaaVerify_ hash in the `vphash` global state key
* check for the creator address, set `booted` global state to `1`
* check for duplicate VAA
* handle the governance VAA passed as argument.

See below on how governance VAAs are processed, and how duplicate detection technique is used.

### publishMessage

The `publishMessage` call will retrieve the current sequence number from related _TmplSig_ local store, increment in by 1, store the new sequence number  and emit a Log message which can be picked by Wormhole network for subsequently creating  a guardian-signed VAA message.

### hdlGovernance

Governance messages can carry requests for:

* Update the active guardian set
* Upgrade contracts: For Algorand, an upgrade-contract governance VAA must contain the hash of the program that is approved as an upgrade (stored in global `validUpdateApproveHash`).  The upgrade process itself is triggered with the **update** action, where the clear and approval program hashes are checked against what the governance VAA carried.  If they differ, an assertion is thrown and the update call is aborted.  A successful call writes an onchain Log with the new hashes and allows the update process to go on.  
* Setting the per-message fee
* Retrieving previously paid message fees

A governance request packed in a VAA must be verified by a `verifyVaa` call in the transaction group.

### vaaVerify

The VAA verify call will work by design *only* in a transaction group structured as:

| TX         | args                                                 | accounts                | sender                |
|------------|------------------------------------------------------|-------------------------|-----------------------|
| verifySigs | [sigs<sub>0..n</sub>, keyset<sub>0..n</sub>, digest] | seq_addr, guardian_addr | vaa_verify_stateless  |
| verifySigs | ...                                                  | seq_addr, guardian_addr | vaa_verify_stateless  |
| verifyVAA  | vaa                                                  | seq_addr, guardian_addr | foundation            |

Keep in mind that depending on the number of signatures to verify there can be one or several _verifySigs_ calls working in tandem with the _VaaVerify_ stateless program. This depends on how many signatures we can verify on a single TX.  At time of this writing, considering the opcode budget limitation of AVM 1.1, a total of nine (9) signatures can be verified at once, so for the current 19 guardians three _verifySigs_ calls would be needed for verifying signatures 0..8, 9..17, 18.  

A successful call must:

* Retrieve the guardian keys from the proper local dynamic storage
* Validate if the VAA passed in Argument #1 has enough guardians to be verified
* Check that it's not expired.
* Check that each guardian signed at most once
* Verify that each _verifySigs_ TX is validated by the correct stateless _VerifyVaa_
* Verify that each _verifySigs_ TX is verifying the expected signature subset.
* Verify that each _verifySigs_ TX is verifying against the same guardian keys.
* Verify that each _verifySigs_ TX is verifying the same VAA.

The vaaVerify call does allow *nop* (dummy) TX  in the group to maximize opcode budgets and/or storage capacity. After the `verifyVAA` call, a client can issue more transactions with the fact that the VAA was verified.
 
## Appendix:  Duplicate verification
------------------------------------
To detect duplicate VAA sequence numbers the following technique is used:

* For each key in local state, there is an associated value entry. The total space of value-entries is 127*15, we have 2K of addressable space using the `LocalBlob` class. 
* A _TmplSig_ stateless account is generated using the 2K space as a bit field, yielding 15240 bits. So for  ~16K consecutive VAA numbers, the contract code sets a bit for identifying already verified VAAs.  Based on setting the stateless `TMPL_ADDR_IDX` to formula `vaa_sequence_number / 15240`, we have designated storage for marking VAAs in consecutive 16k-bit blocks.