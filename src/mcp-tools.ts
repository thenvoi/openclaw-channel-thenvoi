/**
 * MCP Tools for Thenvoi platform operations.
 *
 * Uses @thenvoi/sdk's buildRoomScopedRegistrations to auto-generate tool
 * schemas and execution logic from AgentTools. The SDK is the single source
 * of truth for tool names, schemas, and handlers — new tools or schema
 * changes are picked up automatically on SDK bumps.
 */

import { AgentTools } from "@thenvoi/sdk/runtime";
import { buildRoomScopedRegistrations } from "@thenvoi/sdk/mcp";
import type { McpToolRegistration, McpToolInputSchema, McpToolResult } from "@thenvoi/sdk/mcp";
import { getLinkForRoom } from "./channel.js";

// =============================================================================
// Tool Resolution
// =============================================================================

/**
 * Resolve an AdapterToolsProtocol instance for a given room.
 * Called by the SDK's room-scoped registration builder on each tool invocation.
 */
function resolveToolsForRoom(roomId: string) {
  const link = getLinkForRoom(roomId);
  if (!link) {
    return undefined;
  }
  const tools = new AgentTools({
    roomId,
    rest: link.rest,
    capabilities: link.capabilities,
  });
  return tools.getAdapterTools();
}

// =============================================================================
// Build Registrations via SDK
// =============================================================================

let registrations: McpToolRegistration[];
try {
  registrations = buildRoomScopedRegistrations(
    resolveToolsForRoom,
    {
      enableContactTools: true,
      enableMemoryTools: false,
    },
  );
} catch (error) {
  console.error("[thenvoi] Failed to build MCP tool registrations from SDK:", error);
  registrations = [];
}

// =============================================================================
// Public API (compatible with existing consumers)
// =============================================================================

export interface McpTool {
  name: string;
  description: string;
  inputSchema: McpToolInputSchema;
  handler: (params: unknown) => Promise<unknown>;
}

/**
 * All registered MCP tools, adapted from SDK registrations.
 */
export const mcpTools: McpTool[] = registrations.map((reg) => ({
  name: reg.name,
  description: reg.description,
  inputSchema: reg.inputSchema,
  handler: async (params: unknown) => {
    const result: McpToolResult = await reg.execute(
      (params ?? {}) as Record<string, unknown>,
    );
    // If the SDK returned an error result, throw so OpenClaw surfaces it
    if (result.isError) {
      const text = result.content?.[0]?.text ?? "Unknown tool error";
      throw new Error(text);
    }
    // Return the parsed content for OpenClaw's tool result format
    try {
      return JSON.parse(result.content?.[0]?.text ?? "{}");
    } catch {
      return result;
    }
  },
}));

/**
 * Get a tool by name.
 */
export function getMcpTool(name: string): McpTool | undefined {
  return mcpTools.find((tool) => tool.name === name);
}

/**
 * Execute a tool by name.
 */
export async function executeMcpTool(
  name: string,
  params: unknown,
): Promise<unknown> {
  const tool = getMcpTool(name);

  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  return tool.handler(params);
}

/**
 * Get all tool schemas for registration.
 */
export function getMcpToolSchemas(): Array<{
  name: string;
  description: string;
  inputSchema: McpToolInputSchema;
}> {
  return mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}
