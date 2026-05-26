export type JsonRpcRequest = {
  jsonrpc?: "2.0";
  method: string;
  id: number;
  params?: unknown;
};

export type JsonRpcNotification = {
  jsonrpc?: "2.0";
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc?: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type JsonRpcWireMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function isJsonRpcResponse(msg: JsonRpcWireMessage): msg is JsonRpcResponse {
  return typeof (msg as JsonRpcResponse).id === "number" && ("result" in msg || "error" in msg);
}

export function serializeJsonRpcLine(message: JsonRpcWireMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseJsonRpcLine(line: string): JsonRpcWireMessage {
  return JSON.parse(line) as JsonRpcWireMessage;
}
