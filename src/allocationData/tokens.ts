/**
 * Token registry
 *
 * Each token is uniquely identified by "<blockchain>:<address>" — the same
 * key format used by the DefiLlama Coins API.  This id is what allocations
 * reference via their `underlying` field.
 *
 * Add an entry here whenever a new token address appears in allocations.ts.
 * Set `decimals` to avoid an on-chain call every hour.
 */

export type Token = {
  /** Unique id: "<blockchain>:<address>", e.g. "ethereum:0x80ac24aa..." */
  id: string;
  /** Human-readable token name. */
  name: string;
  /** Canonical chain name matching keys in src/utils/rpcs.ts. */
  blockchain: string;
  /** ERC-20 contract address. */
  address: string;
  /** ERC-20 decimals. Leave undefined to let the adapter read it on-chain. */
  decimals?: number | null;
  /** CoinGecko id — for reference / possible future use. */
  coingeckoId?: string | null;
};

/**
 * Registry of all tracked tokens, keyed by their "<blockchain>:<address>" id.
 *
 * Usage:
 *   import { tokens } from "./tokens";
 *   const token = tokens["ethereum:0x80ac24aa..."];
 */
export const tokens: Record<string, Token> = {
  "ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": {
    id:         "ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    name:       "USD Coin",
    blockchain: "ethereum",
    address:    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals:   6,
    coingeckoId: "usd-coin",
  },
  "ethereum:0x356b8d89c1e1239cbbb9de4815c39a1474d5ba7d": {
    id:         "ethereum:0x356b8d89c1e1239cbbb9de4815c39a1474d5ba7d",
    name:       "Syrup USDT",
    blockchain: "ethereum",
    address:    "0x356b8d89c1e1239cbbb9de4815c39a1474d5ba7d",
    decimals:   6,
  },
  "ethereum:0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b": {
    id:         "ethereum:0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b",
    name:       "Syrup USDC",
    blockchain: "ethereum",
    address:    "0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b",
    decimals:   6,
  },
  "ethereum:0x38464507E02c983F20428a6E8566693fE9e422a9": {
    id:         "ethereum:0x38464507E02c983F20428a6E8566693fE9e422a9",
    name:       "Spark Prime USDC 1",
    blockchain: "ethereum",
    address:    "0x38464507E02c983F20428a6E8566693fE9e422a9",
    decimals:   6,
  },
  "ethereum:0x6c3ea9036406852006290770BEdFcAbA0e23A0e8": {
    id:         "ethereum:0x6c3ea9036406852006290770BEdFcAbA0e23A0e8",
    name:       "PayPal USD",
    blockchain: "ethereum",
    address:    "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8",
    decimals:   6,
  },
  "ethereum:0xe7dF13b8e3d6740fe17CBE928C7334243d86c92f": {
    id:         "ethereum:0xe7dF13b8e3d6740fe17CBE928C7334243d86c92f",
    name:       "Spark USDT",
    blockchain: "ethereum",
    address:    "0xe7dF13b8e3d6740fe17CBE928C7334243d86c92f",
    decimals:   6,
  },
  "ethereum:0x4DEDf26112B3Ec8eC46e7E31EA5e123490B05B8B": {
    id:         "ethereum:0x4DEDf26112B3Ec8eC46e7E31EA5e123490B05B8B",
    name:       "Spark DAI",
    blockchain: "ethereum",
    address:    "0x4DEDf26112B3Ec8eC46e7E31EA5e123490B05B8B",
    decimals:   18,
  },
  "ethereum:0x779224df1c756b4EDD899854F32a53E8c2B2ce5d": {
    id:         "ethereum:0x779224df1c756b4EDD899854F32a53E8c2B2ce5d",
    name:       "Spark PYUSD",
    blockchain: "ethereum",
    address:    "0x779224df1c756b4EDD899854F32a53E8c2B2ce5d",
    decimals:   6,
  },
  "ethereum:0xC02aB1A5eaA8d1B114EF786D9bde108cD4364359": {
    id:         "ethereum:0xC02aB1A5eaA8d1B114EF786D9bde108cD4364359",
    name:       "Spark USDS",
    blockchain: "ethereum",
    address:    "0xC02aB1A5eaA8d1B114EF786D9bde108cD4364359",
    decimals:   18,
  },
  "ethereum:0x377C3bd93f2a2984E1E7bE6A5C22c525eD4A4815": {
    id:         "ethereum:0x377C3bd93f2a2984E1E7bE6A5C22c525eD4A4815",
    name:       "Spark USDC",
    blockchain: "ethereum",
    address:    "0x377C3bd93f2a2984E1E7bE6A5C22c525eD4A4815",
    decimals:   6,
  },
  "ethereum:0xA632D59b9B804a956BfaA9b48Af3A1b74808FC1f": {
    id:         "ethereum:0xA632D59b9B804a956BfaA9b48Af3A1b74808FC1f",
    name:       "Spark.fi PYUSD Reserve",
    blockchain: "ethereum",
    address:    "0xA632D59b9B804a956BfaA9b48Af3A1b74808FC1f",
    decimals:   18,
  },
  "ethereum:0x00836Fe54625BE242BcFA286207795405ca4fD10": {
    id:         "ethereum:0x00836Fe54625BE242BcFA286207795405ca4fD10",
    name:       "Spark.fi USDT Reserve",
    blockchain: "ethereum",
    address:    "0x00836Fe54625BE242BcFA286207795405ca4fD10",
    decimals:   18,
  },
  "avalanche:0x625e7708f30ca75bfd92586e17077590c60eb4cd": {
    id:         "avalanche:0x625e7708f30ca75bfd92586e17077590c60eb4cd",
    name:       "Aave Avalanche USDC",
    blockchain: "avalanche",
    address:    "0x625e7708f30ca75bfd92586e17077590c60eb4cd",
    decimals:   6,
  },
  "avalanche:0x58f93d6b1ef2f44ec379cb975657c132cbed3b6b": {
    id:         "avalanche:0x58f93d6b1ef2f44ec379cb975657c132cbed3b6b",
    name:       "Janus Henderson Anemoy AAA CLO Fund Token",
    blockchain: "avalanche",
    address:    "0x58f93d6b1ef2f44ec379cb975657c132cbed3b6b",
  },
  "ethereum:0x5a0F93D040De44e78F251b03c43be9CF317Dcf64": {
    id:         "ethereum:0x5a0F93D040De44e78F251b03c43be9CF317Dcf64",
    name:       "Janus Henderson Anemoy AAA CLO Fund Token",
    blockchain: "ethereum",
    address:    "0x5a0F93D040De44e78F251b03c43be9CF317Dcf64",
  },
  "ethereum:0x6a9DA2D710BB9B700acde7Cb81F10F1fF8C89041": {
    id:         "ethereum:0x6a9DA2D710BB9B700acde7Cb81F10F1fF8C89041",
    name:       "BlackRock USD Institutional Digital Liquidity Fund - I Class",
    blockchain: "ethereum",
    address:    "0x6a9DA2D710BB9B700acde7Cb81F10F1fF8C89041",
    decimals:   6,
  },
  "ethereum:0x51C2d74017390CbBd30550179A16A1c28F7210fc": {
    id:         "ethereum:0x51C2d74017390CbBd30550179A16A1c28F7210fc",
    name:       "Securitize Tokenized AAA CLO Fund",
    blockchain: "ethereum",
    address:    "0x51C2d74017390CbBd30550179A16A1c28F7210fc",
    decimals:   6,
  },
  "ethereum:0xFa82580c16A31D0c1bC632A36F82e83EfEF3Eec0": {
    id:         "ethereum:0xFa82580c16A31D0c1bC632A36F82e83EfEF3Eec0",
    name:       "Aave Ethereum RLUSD",
    blockchain: "ethereum",
    address:    "0xFa82580c16A31D0c1bC632A36F82e83EfEF3Eec0",
    decimals:   18,
  },
  "ethereum:0xE3190143Eb552456F88464662f0c0C4aC67A77eB": {
    id:         "ethereum:0xE3190143Eb552456F88464662f0c0C4aC67A77eB",
    name:       "Aave Horizon RWA RLUSD",
    blockchain: "ethereum",
    address:    "0xE3190143Eb552456F88464662f0c0C4aC67A77eB",
    decimals:   18,
  },
  "ethereum:0x68215B6533c47ff9f7125aC95adf00fE4a62f79e": {
    id:         "ethereum:0x68215B6533c47ff9f7125aC95adf00fE4a62f79e",
    name:       "Aave Horizon RWA USDC",
    blockchain: "ethereum",
    address:    "0x68215B6533c47ff9f7125aC95adf00fE4a62f79e",
    decimals:   6,
  },
  "ethereum:0xBeefF08dF54897e7544aB01d0e86f013DA354111": {
    id:         "ethereum:0xBeefF08dF54897e7544aB01d0e86f013DA354111",
    name:       "Grove x Steakhouse USDC High Yield",
    blockchain: "ethereum",
    address:    "0xBeefF08dF54897e7544aB01d0e86f013DA354111",
    decimals:   18,
  },
  "ethereum:0xBEEfF0d672ab7F5018dFB614c93981045D4aA98a": {
    id:         "ethereum:0xBEEfF0d672ab7F5018dFB614c93981045D4aA98a",
    name:       "Grove x Steakhouse AUSD",
    blockchain: "ethereum",
    address:    "0xBEEfF0d672ab7F5018dFB614c93981045D4aA98a",
    decimals:   18,
  },
  "ethereum:0xBEEf2B5FD3D94469b7782aeBe6364E6e6FB1B709": {
    id:         "ethereum:0xBEEf2B5FD3D94469b7782aeBe6364E6e6FB1B709",
    name:       "Grove x Steakhouse USDC",
    blockchain: "ethereum",
    address:    "0xBEEf2B5FD3D94469b7782aeBe6364E6e6FB1B709",
    decimals:   18,
  },
  "base:0xBeEf2d50B428675a1921bC6bBF4bfb9D8cF1461A": {
    id:         "base:0xBeEf2d50B428675a1921bC6bBF4bfb9D8cF1461A",
    name:       "Grove x Steakhouse USDC High Yield",
    blockchain: "base",
    address:    "0xBeEf2d50B428675a1921bC6bBF4bfb9D8cF1461A",
    decimals:   18,
  },
  "base:0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9": {
    id:         "base:0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9",
    name:       "SteakUSDC V2",
    blockchain: "base",
    address:    "0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9",
    decimals:   18,
  },
  "ethereum:0x8c213ee79581Ff4984583C6a801e5263418C4b86": {
    id:         "ethereum:0x8c213ee79581Ff4984583C6a801e5263418C4b86",
    name:       "Janus Henderson Anemoy Treasury Fund",
    blockchain: "ethereum",
    address:    "0x8c213ee79581Ff4984583C6a801e5263418C4b86",
  },
  "plume:0x9477724Bb54AD5417de8Baff29e59DF3fB4DA74f": {
    id:         "plume:0x9477724Bb54AD5417de8Baff29e59DF3fB4DA74f",
    name:       "Anemoy Tokenized Apollo Diversified Credit Fund Token",
    blockchain: "plume",
    address:    "0x9477724Bb54AD5417de8Baff29e59DF3fB4DA74f",
  },
  "monad:0x32841A8511D5c2c5b253f45668780B99139e476D": {
    id:         "monad:0x32841A8511D5c2c5b253f45668780B99139e476D",
    name:       "Grove x Steakhouse High Yield AUSD",
    blockchain: "monad",
    address:    "0x32841A8511D5c2c5b253f45668780B99139e476D",
  },
  "monad:0x754704Bc059F8C67012fEd69BC8A327a5aafb603": {
    id:         "monad:0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    name:       "USDC",
    blockchain: "monad",
    address:    "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    decimals:   6,
  },
  "avalanche:0x2c0adff8e114f3ca106051144353ac703d24b901": {
    id:         "avalanche:0x2c0adff8e114f3ca106051144353ac703d24b901",
    name:       "Galaxy Arch CLO Token",
    blockchain: "avalanche",
    address:    "0x2c0adff8e114f3ca106051144353ac703d24b901",
  },
  "ethereum:0xe79c1c7e24755574438a26d5e062ad2626c04662": {
    id:         "ethereum:0xe79c1c7e24755574438a26d5e062ad2626c04662",
    name:       "Curve LP AUSD/USDC",
    blockchain: "ethereum",
    address:    "0xe79c1c7e24755574438a26d5e062ad2626c04662",
    decimals:   18,
  },
  "ethereum:0xbAFeAd7c60Ea473758ED6c6021505E8BBd7e8E5d": {
    id:         "ethereum:0xbAFeAd7c60Ea473758ED6c6021505E8BBd7e8E5d",
    name:       "Uniswap LP AUSD/USDC",
    blockchain: "ethereum",
    address:    "0xbAFeAd7c60Ea473758ED6c6021505E8BBd7e8E5d",
    decimals:   18,
  },
  // Synthetic token IDs for Uniswap V3 LP positions (allocation-specific)
  "ethereum:uniswap-v3-lp-grove-ausd-usdc": {
    id:         "ethereum:uniswap-v3-lp-grove-ausd-usdc",
    name:       "Uniswap V3 LP AUSD/USDC (Grove)",
    blockchain: "ethereum",
    address:    "0x0000000000000000000000000000000000000000",  // Synthetic - no actual token address
    decimals:   18,
  },
};
