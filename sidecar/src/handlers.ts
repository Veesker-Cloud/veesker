import { makeError, makeResult, type JsonRpcRequest, type JsonRpcResponse } from "./rpc";

export type Handler = (params: any) => Promise<unknown>;
export type HandlerMap = Record<string, Handler>;

export async function dispatch(
  handlers: HandlerMap,
  req: JsonRpcRequest
): Promise<JsonRpcResponse> {
  const handler = handlers[req.method];
  if (!handler) {
    return makeError(req.id, -32601, `Method not found: ${req.method}`);
  }
  try {
    const result = await handler(req.params ?? {});
    return makeResult(req.id, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return makeError(req.id, -32000, message);
  }
}
