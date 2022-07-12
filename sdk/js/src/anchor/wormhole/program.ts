import { PublicKey } from "@solana/web3.js";
import { Program, Provider } from "@project-serum/anchor";
import { Wormhole } from "../types/wormhole";
import IDL from "../../idl/wormhole.json";

export function program(wormholeProgramId: PublicKey, provider?: Provider): Program<Wormhole> {
    return new Program<Wormhole>(IDL as Wormhole, wormholeProgramId, provider, coder());
}

export function coder(): undefined {
    return undefined;
}
 