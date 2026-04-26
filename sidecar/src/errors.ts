// Custom JSON-RPC error codes for veesker workspace flow.
// Picked to avoid the JSON-RPC 2.0 reserved range (-32768 .. -32000)
// and our existing transport codes (-32000, -32001, -32002, -32003, -32700, -32601).
export const NO_ACTIVE_SESSION = -32010;
export const SESSION_LOST      = -32011;
export const OBJECT_NOT_FOUND  = -32012;
export const ORACLE_ERR        = -32013;
export const SPLITTER_ERROR    = -32014;
// Connection refused the statement because of a per-connection safety guard.
export const READ_ONLY_BLOCKED  = -32030;
export const UNSAFE_DML_WARNING = -32031;

// Domain code for user-initiated query cancellation.
// Intentionally outside the JSON-RPC reserved range.
export const QUERY_CANCELLED = -2;

export class RpcCodedError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = "RpcCodedError";
  }
}
