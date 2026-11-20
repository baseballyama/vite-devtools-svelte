import { z } from 'zod';

// The part of MCP (JSON-RPC 2.0) these servers speak: initialize, ping,
// tools/list and tools/call. Answers match @modelcontextprotocol/sdk byte for
// byte so SDK clients interoperate.

/** Newest first: `initialize` offers the first one to a client asking for an unknown version. */
export const PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];

type Id = string | number;
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: Id;
  method: string;
  params?: Record<string, unknown>;
}
export type JsonRpcMessage =
  | JsonRpcRequest
  | { jsonrpc: '2.0'; method: string; params?: Record<string, unknown> }
  | { jsonrpc: '2.0'; id?: Id; result?: unknown; error?: unknown };
type JsonRpcResponse =
  | { result: unknown; jsonrpc: '2.0'; id: Id }
  | { jsonrpc: '2.0'; id: Id; error: { code: number; message: string } };

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: { type: 'object'; properties?: Record<string, object>; [key: string]: unknown };
  execution?: { taskSupport: 'forbidden' };
}

export interface ToolHandlers {
  listTools: () => ToolInfo[];
  callTool: (name: string, args: Record<string, unknown> | undefined) => Promise<ToolResult>;
}

export interface McpServer {
  /** The answer to a request; `null` for a notification or a response. */
  handle: (message: JsonRpcMessage) => Promise<JsonRpcResponse | null>;
}

const requestId = z.union([z.string(), z.number().int()]);
const params = z.looseObject({}).optional();
const messageSchema = z.union([
  z.strictObject({ jsonrpc: z.literal('2.0'), id: requestId, method: z.string(), params }),
  z.strictObject({ jsonrpc: z.literal('2.0'), method: z.string(), params }),
  z.strictObject({ jsonrpc: z.literal('2.0'), id: requestId, result: z.looseObject({}) }),
  z.strictObject({
    jsonrpc: z.literal('2.0'),
    id: requestId.optional(),
    error: z.object({ code: z.number().int(), message: z.string(), data: z.unknown().optional() }),
  }),
]);

export const isJsonRpcMessage = (value: unknown): value is JsonRpcMessage =>
  messageSchema.safeParse(value).success;

const requestOf = <T extends z.ZodType>(paramsSchema: T) => z.object({ params: paramsSchema });
const initializeRequest = requestOf(
  z.looseObject({
    protocolVersion: z.string(),
    capabilities: z.looseObject({}),
    clientInfo: z.looseObject({ name: z.string(), version: z.string() }),
  }),
);
const listToolsRequest = requestOf(z.looseObject({ cursor: z.string().optional() }).optional());
const callToolRequest = requestOf(
  z.looseObject({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() }),
);

export const isInitializeRequest = (m: JsonRpcMessage): boolean =>
  'method' in m && m.method === 'initialize' && initializeRequest.safeParse(m).success;

const isRequest = (m: JsonRpcMessage): m is JsonRpcRequest => 'method' in m && 'id' in m;

const cancelledNotification = z.object({
  method: z.literal('notifications/cancelled'),
  params: z.looseObject({ requestId }),
});
const taskRequest = z.object({
  params: z.looseObject({ task: z.looseObject({ ttl: z.number().optional() }) }),
});

export function createMcpServer(
  info: { name: string; version: string; instructions: string },
  tools: ToolHandlers,
): McpServer {
  const methods = new Map<string, (request: JsonRpcRequest) => unknown>([
    [
      'initialize',
      request => {
        const { protocolVersion } = initializeRequest.parse(request).params;
        return {
          protocolVersion: PROTOCOL_VERSIONS.includes(protocolVersion)
            ? protocolVersion
            : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: info.name, version: info.version },
          instructions: info.instructions,
        };
      },
    ],
    ['ping', () => ({})],
    [
      'tools/list',
      request => {
        listToolsRequest.parse(request);
        return { tools: tools.listTools() };
      },
    ],
    [
      'tools/call',
      request => {
        const { name, arguments: args } = callToolRequest.parse(request).params;
        return tools.callTool(name, args);
      },
    ],
  ]);

  // In-flight request ids, mapped to whether the client cancelled them.
  const inFlight = new Map<Id, boolean>();

  const answer = async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
    const { id } = request;
    const method = methods.get(request.method);
    if (!method)
      return { jsonrpc: '2.0', id, error: { code: -32_601, message: 'Method not found' } };
    try {
      // No tasks capability is declared, so a task-augmented request is refused.
      if (taskRequest.safeParse(request).success) {
        throw new Error(`Server does not support task creation (required for ${request.method})`);
      }
      return { result: await method(request), jsonrpc: '2.0', id };
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'Internal error';
      return { jsonrpc: '2.0', id, error: { code: -32_603, message: reason } };
    }
  };

  return {
    async handle(message) {
      if (!isRequest(message)) {
        const cancel = cancelledNotification.safeParse(message);
        const id = cancel.success ? cancel.data.params.requestId : undefined;
        if (id !== undefined && inFlight.has(id)) inFlight.set(id, true);
        return null;
      }
      inFlight.set(message.id, false);
      try {
        const response = await answer(message);
        // A cancelled request gets no answer (MCP cancellation spec).
        return inFlight.get(message.id) ? null : response;
      } finally {
        inFlight.delete(message.id);
      }
    },
  };
}

export function text(value: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  };
}

export const error = (message: string): ToolResult => ({ ...text(message), isError: true });

interface ToolConfig<Shape extends z.ZodRawShape> {
  title: string;
  description: string;
  inputSchema: Shape;
}

interface RegisteredTool {
  title: string;
  description: string;
  schema: z.ZodObject;
  handler: (args: unknown) => ToolResult | Promise<ToolResult>;
}

/** Tools whose input is a zod shape: validated on call and listed as JSON Schema. */
export class ToolRegistry implements ToolHandlers {
  #tools = new Map<string, RegisteredTool>();

  registerTool<Shape extends z.ZodRawShape>(
    name: string,
    { title, description, inputSchema }: ToolConfig<Shape>,
    handler: (args: z.output<z.ZodObject<Shape>>) => ToolResult | Promise<ToolResult>,
  ): void {
    this.#tools.set(name, {
      title,
      description,
      schema: z.object(inputSchema),
      handler: handler as RegisteredTool['handler'],
    });
  }

  listTools(): ToolInfo[] {
    return [...this.#tools].map(([name, tool]) => ({
      name,
      title: tool.title,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.schema, {
        target: 'draft-7',
        io: 'input',
      }) as ToolInfo['inputSchema'],
      execution: { taskSupport: 'forbidden' },
    }));
  }

  async callTool(name: string, args: Record<string, unknown> | undefined): Promise<ToolResult> {
    const tool = this.#tools.get(name);
    if (!tool) return error(`MCP error -32602: Tool ${name} not found`);
    const parsed = await tool.schema.safeParseAsync(args ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map(i =>
        i.path.length > 0 ? `${i.message} at ${i.path.join('.')}` : i.message,
      );
      return error(
        `MCP error -32602: Input validation error: Invalid arguments for tool ${name}: ${issues.join('\n')}`,
      );
    }
    try {
      return await tool.handler(parsed.data);
    } catch (e) {
      return error(e instanceof Error ? e.message : String(e));
    }
  }
}
