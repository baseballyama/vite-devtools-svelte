import * as v from '../schema.js';

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

const isId = (value: unknown): value is Id =>
  typeof value === 'string' || Number.isSafeInteger(value);
const hasOnly = (value: object, keys: string[]) => Object.keys(value).every(k => keys.includes(k));
const optionalObject = (value: unknown): value is Record<string, unknown> | undefined =>
  value === undefined || v.isPlainObject(value);

export function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  if (!v.isPlainObject(value) || value.jsonrpc !== '2.0') return false;
  if ('method' in value) {
    return (
      typeof value.method === 'string' &&
      optionalObject(value.params) &&
      ('id' in value
        ? isId(value.id) && hasOnly(value, ['jsonrpc', 'id', 'method', 'params'])
        : hasOnly(value, ['jsonrpc', 'method', 'params']))
    );
  }
  if ('result' in value) {
    return (
      isId(value.id) && v.isPlainObject(value.result) && hasOnly(value, ['jsonrpc', 'id', 'result'])
    );
  }
  const { error } = value;
  return (
    (value.id === undefined || isId(value.id)) &&
    v.isPlainObject(error) &&
    Number.isSafeInteger(error.code) &&
    typeof error.message === 'string' &&
    hasOnly(value, ['jsonrpc', 'id', 'error'])
  );
}

// The SDK answers bad params with zod's issue list as the message, so these
// issues keep zod's keys and wording.
interface ParamsIssue {
  expected: string;
  code: 'invalid_type';
  path: string[];
  message: string;
}
const kinds = {
  string: (value: unknown): value is string => typeof value === 'string',
  object: v.isPlainObject,
  record: v.isPlainObject,
};

function check<K extends keyof typeof kinds>(
  issues: ParamsIssue[],
  value: unknown,
  expected: K,
  path: string[],
): value is K extends 'string' ? string : Record<string, unknown> {
  if (kinds[expected](value)) return true;
  const message = `Invalid input: expected ${expected}, received ${v.received(value)}`;
  issues.push({ expected, code: 'invalid_type', path, message });
  return false;
}

function initializeIssues(params: unknown): ParamsIssue[] {
  const issues: ParamsIssue[] = [];
  if (check(issues, params, 'object', ['params'])) {
    check(issues, params.protocolVersion, 'string', ['params', 'protocolVersion']);
    check(issues, params.capabilities, 'object', ['params', 'capabilities']);
    if (check(issues, params.clientInfo, 'object', ['params', 'clientInfo'])) {
      check(issues, params.clientInfo.name, 'string', ['params', 'clientInfo', 'name']);
      check(issues, params.clientInfo.version, 'string', ['params', 'clientInfo', 'version']);
    }
  }
  return issues;
}

function throwIfAny(issues: ParamsIssue[]): void {
  if (issues.length > 0) throw new Error(JSON.stringify(issues, null, 2));
}

export const isInitializeRequest = (m: JsonRpcMessage): boolean =>
  'method' in m && m.method === 'initialize' && initializeIssues(m.params).length === 0;

const isRequest = (m: JsonRpcMessage): m is JsonRpcRequest => 'method' in m && 'id' in m;

export function createMcpServer(
  info: { name: string; version: string; instructions: string },
  tools: ToolHandlers,
): McpServer {
  const methods = new Map<string, (request: JsonRpcRequest) => unknown>([
    [
      'initialize',
      request => {
        const { params } = request;
        throwIfAny(initializeIssues(params));
        const { protocolVersion } = params as { protocolVersion: string };
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
        const { params } = request;
        const issues: ParamsIssue[] = [];
        if (
          params !== undefined &&
          check(issues, params, 'object', ['params']) &&
          params.cursor !== undefined
        ) {
          check(issues, params.cursor, 'string', ['params', 'cursor']);
        }
        throwIfAny(issues);
        return { tools: tools.listTools() };
      },
    ],
    [
      'tools/call',
      request => {
        const { params } = request;
        const issues: ParamsIssue[] = [];
        if (check(issues, params, 'object', ['params'])) {
          check(issues, params.name, 'string', ['params', 'name']);
          if (params.arguments !== undefined) {
            check(issues, params.arguments, 'record', ['params', 'arguments']);
          }
        }
        throwIfAny(issues);
        const { name, arguments: args } = params as {
          name: string;
          arguments?: Record<string, unknown>;
        };
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
      // The ttl check matches the SDK's TaskMetadata shape, which decided what a task is.
      const task = request.params?.task;
      if (v.isPlainObject(task) && (task.ttl === undefined || typeof task.ttl === 'number')) {
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
        const id =
          'method' in message && message.method === 'notifications/cancelled'
            ? message.params?.requestId
            : undefined;
        if (isId(id) && inFlight.has(id)) inFlight.set(id, true);
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

export const toolError = (message: string): ToolResult => ({ ...text(message), isError: true });

interface ToolConfig<Shape extends v.Shape> {
  title: string;
  description: string;
  inputSchema: Shape;
}

interface RegisteredTool {
  title: string;
  description: string;
  schema: v.Schema<object>;
  handler: (args: object) => ToolResult | Promise<ToolResult>;
}

/** Tools whose input is a schema shape: validated on call and listed as JSON Schema. */
export class ToolRegistry implements ToolHandlers {
  #tools = new Map<string, RegisteredTool>();

  registerTool<Shape extends v.Shape>(
    name: string,
    { title, description, inputSchema }: ToolConfig<Shape>,
    handler: (args: v.ObjectOf<Shape>) => ToolResult | Promise<ToolResult>,
  ): void {
    this.#tools.set(name, {
      title,
      description,
      schema: v.object(inputSchema),
      handler: handler as RegisteredTool['handler'],
    });
  }

  listTools(): ToolInfo[] {
    return [...this.#tools].map(([name, tool]) => ({
      name,
      title: tool.title,
      description: tool.description,
      inputSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        // Repeated from the JSON Schema for ToolInfo's literal type.
        type: 'object',
        ...tool.schema.toJsonSchema(),
      },
      execution: { taskSupport: 'forbidden' },
    }));
  }

  async callTool(name: string, args: Record<string, unknown> | undefined): Promise<ToolResult> {
    const tool = this.#tools.get(name);
    if (!tool) return toolError(`MCP error -32602: Tool ${name} not found`);
    const parsed = tool.schema['~standard'].validate(args ?? {});
    if (parsed.issues) {
      const issues = parsed.issues.map(i =>
        i.path?.length ? `${i.message} at ${i.path.join('.')}` : i.message,
      );
      return toolError(
        `MCP error -32602: Input validation error: Invalid arguments for tool ${name}: ${issues.join('\n')}`,
      );
    }
    try {
      return await tool.handler(parsed.value);
    } catch (e) {
      return toolError(e instanceof Error ? e.message : String(e));
    }
  }
}
