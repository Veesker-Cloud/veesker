export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: number | string | null; result: unknown }
  | { jsonrpc: "2.0"; id: number | string | null; error: { code: number; message: string; data?: unknown } };

export function parseRequest(line: string): JsonRpcRequest | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (
    typeof obj !== "object" ||
    obj === null ||
    (obj as any).jsonrpc !== "2.0" ||
    typeof (obj as any).method !== "string" ||
    (typeof (obj as any).id !== "number" && typeof (obj as any).id !== "string")
  ) {
    return null;
  }
  return obj as JsonRpcRequest;
}

export function makeResult(id: number | string, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function makeError(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  const error: { code: number; message: string; data?: unknown } = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}
