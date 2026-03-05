/**
 * priceAdapters — custom price adapter registry
 *
 * Maps "<blockchain>:<address>" token IDs to a price adapter config.
 * Used as a fallback for tokens that the DefiLlama Coins API does not cover.
 *
 * Adapter types:
 *  - "chainlinkFeed"  Chainlink-compatible push oracle (Chronicle, Redstone, Chainlink)
 *  - "erc4626"        ERC4626 vault NAV-per-share (totalAssets / totalSupply)
 *  - "aaveOracle"     Aave / Sparklend protocol-native oracle
 *  - "morphoVault"    MetaMorpho vault (V1 & V2) share price via convertToAssets
 *  - "hardcoded"      Static price — use when no oracle exists
 */

type ChainlinkFeedAdapter = {
  type: "chainlinkFeed";
  /** Canonical chain name matching keys in src/utils/rpcs.ts */
  chain: string;
  /** On-chain oracle contract address */
  oracleAddress: string;
};

type ChronicleVaoAdapter = {
  type: "chronicleVao";
  /**
   * Canonical chain name where the oracle is deployed.
   * Note: RWA Chronicle VAO oracles are always on Ethereum even when the
   * token itself lives on another chain (Avalanche, Plume, etc.).
   */
  chain: string;
  /** Chronicle VAO contract address — exposes read() → uint256 (WAD-scaled) */
  oracleAddress: string;
};

type Erc4626Adapter = {
  type: "erc4626";
  /** Canonical chain name matching keys in src/utils/rpcs.ts */
  chain: string;
  /** ERC4626 vault contract address (same as the token address) */
  vaultAddress: string;
  /**
   * USD price of 1 unit of the vault's underlying token.
   * Omit for USD stablecoin vaults (defaults to 1 in the adapter).
   */
  underlyingPriceUsd?: number;
};

type AaveOracleAdapter = {
  type: "aaveOracle";
  /** Canonical chain name matching keys in src/utils/rpcs.ts */
  chain: string;
  /**
   * The aToken contract address (same as the token registry key and
   * allocation.underlying address).  UNDERLYING_ASSET_ADDRESS() is called on
   * this contract to resolve the underlying ERC-20 before querying the oracle.
   */
  aTokenAddress: string;
  /**
   * The AaveOracle (or Sparklend oracle) contract for the relevant market.
   * Each market / chain has its own oracle instance.
   */
  oracleAddress: string;
};

type MorphoVaultAdapter = {
  type: "morphoVault";
  /** Canonical chain name matching keys in src/utils/rpcs.ts */
  chain: string;
  /**
   * The MetaMorpho vault contract address (V1 or V2).
   * convertToAssets(10^18) is called to get the share price, and asset() is
   * called to discover the underlying token. The underlying token's USD price
   * must already be available in the prices map.
   */
  vaultAddress: string;
};

type HardcodedAdapter = {
  type: "hardcoded";
  /** Fixed USD price to return */
  price: number;
};

type UniswapV3PositionAdapter = {
  type: "uniswapV3Position";
  /**
   * For Uniswap V3 LP positions, the balance adapter calculates the total USD
   * value directly. This adapter always returns 1.0, so balance × price = USD value.
   */
};

export type PriceAdapterConfig =
  | ChainlinkFeedAdapter
  | ChronicleVaoAdapter
  | Erc4626Adapter
  | AaveOracleAdapter
  | MorphoVaultAdapter
  | HardcodedAdapter
  | UniswapV3PositionAdapter;

/**
 * Custom price adapters for tokens not covered by the DefiLlama API.
 * Keyed by "<blockchain>:<address>" — the same id format used throughout the app.
 */
export const priceAdapters: Record<string, PriceAdapterConfig> = {
  // ── Janus Henderson Anemoy Treasury Fund (JTRSY) ──────────────────────────
  // oracle: Chronicle push on Ethereum
  // ref: prices_oracles_reference.md › grove.centrifuge.ethereum JTRSY canonical1
  "ethereum:0x8c213ee79581Ff4984583C6a801e5263418C4b86": {
    type: "chainlinkFeed",
    chain: "ethereum",
    oracleAddress: "0x59ef4BE3eDDF0270c4878b7B945bbeE13fb33d0D",
  },

  // ── BlackRock USD Institutional Digital Liquidity Fund - I Class (BUIDL-I) ─
  // oracle: Redstone push on Ethereum
  // ref: prices_oracles_reference.md › grove.blackrock.ethereum BUIDL-I canonical1
  "ethereum:0x6a9DA2D710BB9B700acde7Cb81F10F1fF8C89041": {
    type: "chainlinkFeed",
    chain: "ethereum",
    oracleAddress: "0xb9BD795BB71012c0F3cd1D9c9A4c686F2d3524A4",
  },

  // ── Galaxy Arch CLO Token ─────────────────────────────────────────────────
  // No oracle or API known — hardcoded to $1 per token
  // ref: prices_oracles_reference.md › grove.inx.avalanche GACLO-1
  "avalanche:0x2c0adff8e114f3ca106051144353ac703d24b901": {
    type: "hardcoded",
    price: 1,
  },

  // ── Spark Prime USDC 1 (Arkis vault) ─────────────────────────────────────
  // No oracle available (canonical1 = "none"). Priced via ERC4626 totalAssets.
  // Underlying is USDC (≈ $1), so underlyingPriceUsd defaults to 1.
  // ref: prices_oracles_reference.md › spark.arkis.ethereum sparkPrimeUSDC1
  "ethereum:0x38464507E02c983F20428a6E8566693fE9e422a9": {
    type: "erc4626",
    chain: "ethereum",
    vaultAddress: "0x38464507E02c983F20428a6E8566693fE9e422a9",
    // underlyingPriceUsd omitted — defaults to 1 (USDC vault)
  },

  // ── Janus Henderson Anemoy AAA CLO Fund Token (JAAA) on Avalanche ─────────
  // oracle: Chronicle VAO on Ethereum (fund NAV is chain-agnostic; VAO type uses read())
  // ref: prices_oracles_reference.md › grove.centrifuge.avalanche JAAA canonical1
  "avalanche:0x58f93d6b1ef2f44ec379cb975657c132cbed3b6b": {
    type: "chronicleVao",
    chain: "ethereum",
    oracleAddress: "0x02cf8C9fBa24d79886dAc40cb620f0930C6E8eC0",
  },

  // ── Anemoy Tokenized Apollo Diversified Credit Fund Token (ACRDX) on Plume ─
  // oracle: Chronicle VAO on Ethereum (fund NAV is chain-agnostic; VAO type uses read())
  // ref: prices_oracles_reference.md › grove.centrifuge.plume ACRDX canonical1
  "plume:0x9477724Bb54AD5417de8Baff29e59DF3fB4DA74f": {
    type: "chronicleVao",
    chain: "ethereum",
    oracleAddress: "0x51cC9463788b870D1e9Bacd111a9bbB2C9820c7e",
  },

  // ── Securitize Tokenized AAA CLO Fund (STAC) ─────────────────────────────
  // oracle: Chronicle VAO on Ethereum (canonical1)
  // ref: prices_oracles_reference.md › grove.securitize.ethereum STAC canonical1
  "ethereum:0x51C2d74017390CbBd30550179A16A1c28F7210fc": {
    type: "chronicleVao",
    chain: "ethereum",
    oracleAddress: "0x9D77E4cA90E25114AFb24dF908f5918f572D958B",
  },

  // ── Sparklend Ethereum ────────────────────────────────────────────────────
  // All five spTokens use the Sparklend oracle at 0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9.
  // UNDERLYING_ASSET_ADDRESS() is called on each aToken to resolve the asset
  // before getAssetPrice() is invoked.
  // ref: prices_oracles_reference.md › spark.sparklend.ethereum

  // spUSDT (Spark USDT) — underlying: USDT
  "ethereum:0xe7dF13b8e3d6740fe17CBE928C7334243d86c92f": {
    type: "aaveOracle",
    chain: "ethereum",
    aTokenAddress: "0xe7dF13b8e3d6740fe17CBE928C7334243d86c92f",
    oracleAddress: "0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9",
  },

  // spDAI (Spark DAI) — underlying: DAI
  "ethereum:0x4DEDf26112B3Ec8eC46e7E31EA5e123490B05B8B": {
    type: "aaveOracle",
    chain: "ethereum",
    aTokenAddress: "0x4DEDf26112B3Ec8eC46e7E31EA5e123490B05B8B",
    oracleAddress: "0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9",
  },

  // spPYUSD (Spark PYUSD) — underlying: PYUSD
  "ethereum:0x779224df1c756b4EDD899854F32a53E8c2B2ce5d": {
    type: "aaveOracle",
    chain: "ethereum",
    aTokenAddress: "0x779224df1c756b4EDD899854F32a53E8c2B2ce5d",
    oracleAddress: "0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9",
  },

  // spUSDS (Spark USDS) — underlying: USDS
  "ethereum:0xC02aB1A5eaA8d1B114EF786D9bde108cD4364359": {
    type: "aaveOracle",
    chain: "ethereum",
    aTokenAddress: "0xC02aB1A5eaA8d1B114EF786D9bde108cD4364359",
    oracleAddress: "0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9",
  },

  // spUSDC (Spark USDC) — underlying: USDC
  "ethereum:0x377C3bd93f2a2984E1E7bE6A5C22c525eD4A4815": {
    type: "aaveOracle",
    chain: "ethereum",
    aTokenAddress: "0x377C3bd93f2a2984E1E7bE6A5C22c525eD4A4815",
    oracleAddress: "0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9",
  },

  // ── Aave Ethereum Core Market ─────────────────────────────────────────────
  // oracle: 0x54586bE62E3c3580375aE3723C145253060Ca0C2
  // ref: prices_oracles_reference.md › grove.aave.ethereum (core)

  // aEthRLUSD (Aave Ethereum RLUSD) — underlying: RLUSD
  "ethereum:0xFa82580c16A31D0c1bC632A36F82e83EfEF3Eec0": {
    type: "aaveOracle",
    chain: "ethereum",
    aTokenAddress: "0xFa82580c16A31D0c1bC632A36F82e83EfEF3Eec0",
    oracleAddress: "0x54586bE62E3c3580375aE3723C145253060Ca0C2",
  },

  // ── Aave Ethereum Horizon Market ──────────────────────────────────────────
  // oracle: 0x985BcfAB7e0f4EF2606CC5b64FC1A16311880442
  // ref: prices_oracles_reference.md › grove.aave.ethereum (horizon)

  // aHorRwaRLUSD (Aave Horizon RWA RLUSD) — underlying: RLUSD
  "ethereum:0xE3190143Eb552456F88464662f0c0C4aC67A77eB": {
    type: "aaveOracle",
    chain: "ethereum",
    aTokenAddress: "0xE3190143Eb552456F88464662f0c0C4aC67A77eB",
    oracleAddress: "0x985BcfAB7e0f4EF2606CC5b64FC1A16311880442",
  },

  // aHorRwaUSDC (Aave Horizon RWA USDC) — underlying: USDC
  "ethereum:0x68215B6533c47ff9f7125aC95adf00fE4a62f79e": {
    type: "aaveOracle",
    chain: "ethereum",
    aTokenAddress: "0x68215B6533c47ff9f7125aC95adf00fE4a62f79e",
    oracleAddress: "0x985BcfAB7e0f4EF2606CC5b64FC1A16311880442",
  },

  // ── Aave Avalanche Core Market ────────────────────────────────────────────
  // oracle: 0xEBd36016B3eD09D4693Ed4251c67Bd858c3c7C9C
  // ref: prices_oracles_reference.md › spark.aave.avalanche (core)

  // aAvaUSDC (Aave Avalanche USDC) — underlying: USDC.e
  "avalanche:0x625e7708f30ca75bfd92586e17077590c60eb4cd": {
    type: "aaveOracle",
    chain: "avalanche",
    aTokenAddress: "0x625e7708f30ca75bfd92586e17077590c60eb4cd",
    oracleAddress: "0xEBd36016B3eD09D4693Ed4251c67Bd858c3c7C9C",
  },

  // ── MetaMorpho Vaults ─────────────────────────────────────────────────────
  // All MetaMorpho vaults (V1 & V2) are ERC-4626 compliant and are priced by
  // calling convertToAssets(10^18) to get the share price, then multiplying
  // by the underlying asset's USD price.
  // ref: docs/morpho_spec.md §Share-Based Accounting (ERC-4626)

  // Grove x Steakhouse USDC High Yield (Ethereum) — underlying: USDC
  "ethereum:0xBeefF08dF54897e7544aB01d0e86f013DA354111": {
    type: "morphoVault",
    chain: "ethereum",
    vaultAddress: "0xBeefF08dF54897e7544aB01d0e86f013DA354111",
  },

  // Grove x Steakhouse AUSD (Ethereum) — underlying: AUSD
  "ethereum:0xBEEfF0d672ab7F5018dFB614c93981045D4aA98a": {
    type: "morphoVault",
    chain: "ethereum",
    vaultAddress: "0xBEEfF0d672ab7F5018dFB614c93981045D4aA98a",
  },

  // Grove x Steakhouse USDC (Ethereum) — underlying: USDC
  "ethereum:0xBEEf2B5FD3D94469b7782aeBe6364E6e6FB1B709": {
    type: "morphoVault",
    chain: "ethereum",
    vaultAddress: "0xBEEf2B5FD3D94469b7782aeBe6364E6e6FB1B709",
  },

  // Grove x Steakhouse USDC High Yield (Base) — underlying: USDC
  "base:0xBeEf2d50B428675a1921bC6bBF4bfb9D8cF1461A": {
    type: "morphoVault",
    chain: "base",
    vaultAddress: "0xBeEf2d50B428675a1921bC6bBF4bfb9D8cF1461A",
  },

  // SteakUSDC V2 (Base) — underlying: USDC
  "base:0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9": {
    type: "morphoVault",
    chain: "base",
    vaultAddress: "0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9",
  },

  // Grove x Steakhouse High Yield AUSD (Monad) — underlying: AUSD
  "monad:0x32841A8511D5c2c5b253f45668780B99139e476D": {
    type: "morphoVault",
    chain: "monad",
    vaultAddress: "0x32841A8511D5c2c5b253f45668780B99139e476D",
  },

  // ── Uniswap V3 LP Positions ───────────────────────────────────────────────
  // For Uniswap V3 positions, the balance adapter computes the total USD value
  // of all matching positions, so price is always 1.0.

  // Uniswap V3 LP AUSD/USDC (Grove) — synthetic token ID
  "ethereum:uniswap-v3-lp-grove-ausd-usdc": {
    type: "uniswapV3Position",
  },
};

