/**
 * Star configuration
 *
 * Each entry describes a MakerDAO allocator ilk whose total DAI debt we track,
 * and a subproxy address whose USDS balance we track as "rc".
 *
 * ilk bytes32 derivation: UTF-8 name right-padded with zero bytes to 32 bytes.
 *   "ALLOCATOR-SPARK-A" → 17 bytes → 0x414c4c4f4341544f522d535041524b2d41 + 15 zero bytes
 *   "ALLOCATOR-BLOOM-A" → 17 bytes → 0x414c4c4f4341544f522d424c4f4f4d2d41 + 15 zero bytes
 *   "ALLOCATOR-OBEX-A"  → 16 bytes → 0x414c4c4f4341544f522d4f4245582d41   + 16 zero bytes
 *
 * ref: docs/debt_calculation_reference.md
 */

export type StarConfig = {
  /** Unique identifier, matches the "star" field in allocations. */
  id: string;
  /** Display name, e.g. "Spark". */
  name: string;
  /** Human-readable ilk name, e.g. "ALLOCATOR-SPARK-A". */
  ilkName: string;
  /**
   * bytes32 ilk identifier for the MakerDAO Vat.
   * UTF-8-encoded ilk name right-padded with zero bytes to 32 bytes.
   */
  ilk: string;
  /**
   * Subproxy contract that holds the star's USDS balance (rc).
   * Format: "<chain>:<address>".
   */
  subproxy: string;
  /** If true, exclude from store and API responses. */
  skip?: boolean;
};

export const stars: StarConfig[] = [
  {
    id: "spark",
    name: "Spark",
    ilkName: "ALLOCATOR-SPARK-A",
    ilk: "0x414c4c4f4341544f522d535041524b2d41000000000000000000000000000000",
    subproxy: "ethereum:0x3300f198988e4C9C63F75dF86De36421f06af8c4",
  },
  {
    id: "grove",
    name: "Grove",
    ilkName: "ALLOCATOR-BLOOM-A", // on-chain ilk name for Grove is ALLOCATOR-BLOOM-A
    ilk: "0x414c4c4f4341544f522d424c4f4f4d2d41000000000000000000000000000000",
    subproxy: "ethereum:0x1369f7b2b38c76B6478c0f0E66D94923421891Ba",
  },
  {
    id: "obex",
    name: "Obex",
    ilkName: "ALLOCATOR-OBEX-A",
    ilk: "0x414c4c4f4341544f522d4f4245582d4100000000000000000000000000000000",
    subproxy: "ethereum:0x8be042581f581E3620e29F213EA8b94afA1C8071",
  },
];
