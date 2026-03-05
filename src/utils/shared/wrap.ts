import { IResponse, credentialsCorsHeaders } from "./lambda-response";

type Event =
  | AWSLambda.APIGatewayEvent
  | { source: string };

/** Wraps an API Gateway Lambda handler with CORS headers. */
function wrap(
  lambdaFunc: (event: AWSLambda.APIGatewayEvent) => Promise<IResponse>
): (event: Event, context?: any, callback?: any) => Promise<IResponse | "pinged" | undefined> | void {
  return async (event: Event) => {
    if ("source" in event) {
      if (event.source === "serverless-plugin-warmup") {
        return "pinged";
      }
      throw new Error("Unexpected source");
    }
    const response = await lambdaFunc(event);
    return {
      ...response,
      headers: {
        ...response.headers,
        ...credentialsCorsHeaders(),
      },
    };
  };
}

export default wrap;

/** Wraps a scheduled (cron) Lambda handler. */
export function wrapScheduledLambda(
  lambdaFunc: (event: any, context: AWSLambda.Context) => Promise<void>
): (event: void, context?: any, callback?: any) => Promise<void | undefined> | void {
  return lambdaFunc as any;
}
