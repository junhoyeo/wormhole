use cosmwasm_std::{
    Binary,
    Uint128,
};
use schemars::JsonSchema;
use serde::{
    Deserialize,
    Serialize,
};
use terraswap::asset::{
    Asset,
    AssetInfo,
};

type HumanAddr = String;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub wormhole_contract: HumanAddr,
    pub token_bridge_contract: HumanAddr,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    CompleteTransferWithPayload {
        data: Binary,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct MigrateMsg {}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    WrappedRegistry { chain: u16, address: Binary },
}