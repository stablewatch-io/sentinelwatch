/**
 * config — API Lambda
 *
 * Returns the list of tracked allocations so API consumers can discover
 * what ids, names, protocols and blockchains are available.
 *
 * Route: GET /config
 */

import { successResponse, wrap, IResponse } from "./utils/shared";
import allocations from "./allocationData/allocations";

const handler = async (
  _event: AWSLambda.APIGatewayEvent
): Promise<IResponse> => {
  const response = allocations.map((a) => ({
    id: a.id,
    name: a.name,
    protocol: a.protocol,
    blockchain: a.underlying ? a.underlying.split(":")[0] : null,
    star: a.star,
    underlying: a.underlying ?? null,
    holdingWallet: a.holdingWallet,
    isYBS: a.isYBS ?? null,
    isLending: a.isLending ?? null,
    isLP: a.isLP ?? null,
  }));
  return successResponse(response, 10 * 60); // 10-min cache
};

export default wrap(handler);
