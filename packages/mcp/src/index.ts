import type { Selection } from "@vibesvg/ast";
import { jsonRpcError, jsonRpcResult, type JsonRpcRequest, type JsonRpcResponse } from "./json-rpc.js";
import { mcpResources, mcpResourceTemplates, readMcpResource } from "./resources.js";
import { callMcpTool, mcpTools, type VibeSVGMcpStore, type ToolContext } from "./tools.js";

export type VibeSVGMcpContext = ToolContext & {
  store: VibeSVGMcpStore & {
    selection(): Selection;
  };
};

export async function handleMcpBody(context: VibeSVGMcpContext, body: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    const responses = await Promise.all(body.map((item) => handleMcpMessage(context, item)));
    const filteredResponses = responses.filter((response): response is JsonRpcResponse => Boolean(response));

    return filteredResponses.length > 0 ? filteredResponses : null;
  }

  return handleMcpMessage(context, body);
}

export async function handleMcpMessage(context: VibeSVGMcpContext, rawRequest: unknown): Promise<JsonRpcResponse | null> {
  const request = rawRequest as JsonRpcRequest;

  if (request.id === undefined || request.id === null) {
    return null;
  }

  try {
    switch (request.method) {
      case "initialize":
        return jsonRpcResult(request.id, {
          protocolVersion: stringParam(request.params?.protocolVersion) ?? "2024-11-05",
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false }
          },
          serverInfo: {
            name: "vibesvg",
            version: "0.0.0"
          }
        });
      case "ping":
        return jsonRpcResult(request.id, {});
      case "tools/list":
        return jsonRpcResult(request.id, { tools: mcpTools() });
      case "resources/list":
        return jsonRpcResult(request.id, { resources: mcpResources() });
      case "resources/templates/list":
        return jsonRpcResult(request.id, { resourceTemplates: mcpResourceTemplates() });
      case "resources/read":
        return jsonRpcResult(
          request.id,
          readMcpResource(
            context.store.readProject(),
            context.store.selection(),
            context.store.revision(),
            String(request.params?.uri ?? "")
          )
        );
      case "tools/call":
        return jsonRpcResult(
          request.id,
          callMcpTool(
            context,
            String(request.params?.name ?? ""),
            recordParam(request.params?.arguments)
          )
        );
      default:
        return jsonRpcError(request.id, -32601, `Unsupported MCP method: ${request.method ?? ""}`);
    }
  } catch (error) {
    return jsonRpcError(request.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

function recordParam(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export { mcpResources, mcpResourceTemplates, mcpTools };
