// ---------------------------------------------------------------------------
// RPC configuration
// ---------------------------------------------------------------------------
// chainToRpcUrl — used by providers.ts to instantiate ethers.js providers.
//   Keys are the chain names used throughout the codebase.
//   Values are read from environment variables so secrets never live in code.
//   Add a static string only for chains that have stable public RPCs.
// ---------------------------------------------------------------------------

export const chainToRpcUrl: Record<string, string | undefined> = {
	ethereum: process.env.ETHEREUM_RPC_URL,
	'binance-smart-chain': process.env.BINANCE_RPC_URL,
	avalanche: process.env.AVALANCHE_RPC_URL,
	arbitrum: process.env.ARBITRUM_RPC_URL,
	base: process.env.BASE_RPC_URL,
	optimism: process.env.OPTIMISM_RPC_URL,
	polygon: process.env.POLYGON_RPC_URL,
	sonic: process.env.SONIC_RPC_URL,
	hyperevm: process.env.HYPEREVM_RPC_URL,
	fraxtal: process.env.FRAXTAL_RPC_URL,
	xdai: process.env.GNOSIS_RPC_URL,
	linea: process.env.LINEA_RPC_URL,
	celo: process.env.CELO_RPC_URL,
	unichain: process.env.UNICHAIN_RPC_URL,
	monad: process.env.MONAD_RPC_URL,
	etlk: 'https://node.mainnet.etherlink.com',
	sapphire: 'https://sapphire.oasis.io',
	plume: 'https://rpc.plume.org',
	rsk: 'https://public-node.rsk.co',
};

// ---------------------------------------------------------------------------
// Chain metadata
// ---------------------------------------------------------------------------

export type ChainName = keyof typeof chainNameToChainId;

export const chainNameToChainId: Record<
	string,
	{ chainId: number | undefined; display?: string }
> = {
	ethereum: { chainId: 1, display: 'Ethereum' },
	'binance-smart-chain': { chainId: 56, display: 'BSC' },
	avalanche: { chainId: 43114, display: 'Avalanche' },
	arbitrum: { chainId: 42161, display: 'Arbitrum' },
	base: { chainId: 8453, display: 'Base' },
	optimism: { chainId: 10, display: 'Optimism' },
	polygon: { chainId: 137, display: 'Polygon' },
	fraxtal: { chainId: 252, display: 'Fraxtal' },
	celo: { chainId: 42220, display: 'Celo' },
	xdai: { chainId: 100, display: 'Gnosis Chain' },
	linea: { chainId: 59144, display: 'Linea' },
	sonic: { chainId: 146, display: 'Sonic' },
	unichain: { chainId: 130, display: 'Unichain' },
	hyperevm: { chainId: 999, display: 'HyperEVM' },
	monad: { chainId: 10143, display: 'Monad' },
	plume: { chainId: undefined, display: 'Plume' },
	etlk: { chainId: undefined, display: 'Etherlink' },
	sapphire: { chainId: undefined, display: 'Oasis Sapphire' },
	rsk: { chainId: undefined, display: 'Rootstock' },
};

