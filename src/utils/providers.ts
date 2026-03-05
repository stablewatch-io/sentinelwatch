import { ethers } from 'ethers';
import { chainToRpcUrl } from './rpcs';

/**
 * Returns an ethers.js JsonRpcProvider for the given chain, using the
 * RPC URL configured in environment variables (see rpcs.ts / .env).
 *
 * Performs a network-detection handshake with a 30 s timeout so connection
 * problems surface quickly rather than hanging silently.
 */
export async function getRpcProvider(chain: string): Promise<ethers.JsonRpcProvider> {
	const rpcUrl = chainToRpcUrl[chain];
	if (!rpcUrl) {
		throw new Error(
			`No RPC URL configured for "${chain}". ` +
			`Set the matching *_RPC_URL env var and add an entry to chainToRpcUrl in rpcs.ts.`
		);
	}

	const provider = new ethers.JsonRpcProvider(rpcUrl);

	const timeout = new Promise<never>((_, reject) =>
		setTimeout(
			() => reject(new Error(`Provider network detection timeout for ${chain}`)),
			30_000
		)
	);

	try {
		await Promise.race([provider.getNetwork(), timeout]);
		return provider;
	} catch (error) {
		provider.destroy();
		throw error;
	}
}

/**
 * Returns a synchronous (non-awaited) ethers.js JsonRpcProvider.
 * Use this inside Lambda handlers where you don't need to pre-validate
 * the connection — the first actual RPC call will fail fast if the URL is bad.
 */
export function getProvider(chain: string): ethers.JsonRpcProvider {
	const rpcUrl = chainToRpcUrl[chain];
	if (!rpcUrl) {
		throw new Error(
			`No RPC URL configured for "${chain}". ` +
			`Set the matching *_RPC_URL env var and add an entry to chainToRpcUrl in rpcs.ts.`
		);
	}
	return new ethers.JsonRpcProvider(rpcUrl);
}

