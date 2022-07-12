const fs = require("fs");

const SRC_IDL = __dirname + "/../../../solana/idl";
const DST_IDL = __dirname + "/../src/idl";
const TS = __dirname + "/../src/anchor/types";

const programs = {
    "wormhole.json": "Wormhole",
    "token_bridge.json": "TokenBridge",
    "nft_bridge.json": "NftBridge",
};

function main() {
    if (!fs.existsSync(DST_IDL)) {
        fs.mkdirSync(DST_IDL);
    }

    if (!fs.existsSync(TS)) {
        fs.mkdirSync(TS);
    }

    for (const basename of fs.readdirSync(SRC_IDL)) {
        const idl = DST_IDL + "/" + basename;
        fs.copyFileSync(SRC_IDL + "/" + basename, idl);

        const targetTypescript = TS + "/" + basename.replace("json", "ts");
        fs.writeFileSync(targetTypescript, "export type Wormhole = ");
        fs.appendFileSync(targetTypescript, fs.readFileSync(idl));
    }
}

main();