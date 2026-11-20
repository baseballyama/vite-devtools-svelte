// A Standard Schema validator for the few shapes the RPC functions and MCP
// tools take, with the JSON Schema the MCP tools list. MCP clients read the
// messages and JSON Schema, so the mcp-wire snapshot pins them.
// devframe/utils/simple-schema can't replace it: no bounds, no integers, no JSON Schema.

interface Issue {
  message: string;
  path?: PropertyKey[];
}

type Result<T> = { value: T; issues?: undefined } | { issues: Issue[] };

export interface Schema<T = unknown, Optional extends boolean = boolean> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: 'vite-devtools-svelte';
    readonly validate: (value: unknown) => Result<T>;
    // Type-only: devframe infers RPC handler args from it.
    readonly types?: { readonly input: T; readonly output: T };
  };
  readonly optional: Optional;
  /** draft-07 JSON Schema, built fresh on each call. */
  readonly toJsonSchema: () => Record<string, unknown>;
}

type Infer<S> = S extends Schema<infer T> ? T : never;
export type Shape = Record<string, Schema>;
type Flatten<T> = { [K in keyof T]: T[K] };
export type ObjectOf<S extends Shape> = Flatten<
  { [K in keyof S as S[K] extends Schema<unknown, true> ? never : K]: Infer<S[K]> } & {
    [K in keyof S as S[K] extends Schema<unknown, true> ? K : never]?: Infer<S[K]>;
  }
>;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function schema<T, Optional extends boolean = false>(
  validate: (value: unknown) => Result<T>,
  toJsonSchema: () => Record<string, unknown>,
  isOptional = false as Optional,
): Schema<T, Optional> {
  return {
    '~standard': { version: 1, vendor: 'vite-devtools-svelte', validate },
    optional: isOptional,
    toJsonSchema,
  };
}

const ok = <T>(value: T): Result<T> => ({ value });
const fail = (...messages: string[]): Result<never> => ({
  issues: messages.map(message => ({ message })),
});
const checked = <T>(value: T, messages: string[]): Result<T> =>
  messages.length > 0 ? fail(...messages) : ok(value);

export function received(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return typeof value;
}
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const expected = (type: string, value: unknown) =>
  fail(`Invalid input: expected ${type}, received ${received(value)}`);

export function string(
  options: { min?: number; max?: number; test?: (value: string) => boolean; message?: string } = {},
): Schema<string, false> {
  const { min, max, test, message = 'Invalid input' } = options;
  return schema(
    value => {
      if (typeof value !== 'string') return expected('string', value);
      const messages: string[] = [];
      if (min !== undefined && value.length < min)
        messages.push(`Too small: expected string to have >=${min} characters`);
      if (max !== undefined && value.length > max)
        messages.push(`Too big: expected string to have <=${max} characters`);
      if (test && !test(value)) messages.push(message);
      return checked(value, messages);
    },
    () => ({
      type: 'string',
      ...(min !== undefined && { minLength: min }),
      ...(max !== undefined && { maxLength: max }),
    }),
  );
}

interface NumberOptions {
  min?: number;
  max?: number;
  /** Greater than 0. */
  positive?: boolean;
}

function numeric(int: boolean, { min, max, positive }: NumberOptions): Schema<number, false> {
  const type = int ? 'integer' : 'number';
  return schema(
    value => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return expected('number', value);
      if (int && !Number.isInteger(value)) return expected('int', value);
      const messages: string[] = [];
      if (int && value > MAX_SAFE) messages.push(`Too big: expected int to be <=${MAX_SAFE}`);
      if (int && value < -MAX_SAFE) messages.push(`Too small: expected int to be >=${-MAX_SAFE}`);
      if (positive && value <= 0) messages.push('Too small: expected number to be >0');
      if (min !== undefined && value < min)
        messages.push(`Too small: expected number to be >=${min}`);
      if (max !== undefined && value > max)
        messages.push(`Too big: expected number to be <=${max}`);
      return checked(value, messages);
    },
    () => {
      const json: Record<string, unknown> = { type };
      if (positive) json.exclusiveMinimum = 0;
      else if (min !== undefined) json.minimum = min;
      else if (int) json.minimum = -MAX_SAFE;
      if (max !== undefined) json.maximum = max;
      else if (int) json.maximum = MAX_SAFE;
      return json;
    },
  );
}

/** A finite number. */
export const number = (options: NumberOptions = {}): Schema<number, false> =>
  numeric(false, options);

/** A safe integer. */
export const integer = (options: NumberOptions = {}): Schema<number, false> =>
  numeric(true, options);

export const boolean = (): Schema<boolean, false> =>
  schema(
    value => (typeof value === 'boolean' ? ok(value) : expected('boolean', value)),
    () => ({ type: 'boolean' }),
  );

export function oneOf<const T extends readonly string[]>(values: T): Schema<T[number], false> {
  return schema(
    value =>
      values.includes(value as string)
        ? ok(value as T[number])
        : fail(`Invalid option: expected one of ${values.map(v => JSON.stringify(v)).join('|')}`),
    () => ({ type: 'string', enum: [...values] }),
  );
}

export function optional<T>(inner: Schema<T>): Schema<T | undefined, true> {
  return schema(
    value => (value === undefined ? ok(value) : inner['~standard'].validate(value)),
    inner.toJsonSchema,
    true,
  );
}

/** Drops keys that are not in `shape`. */
export function object<S extends Shape>(shape: S): Schema<ObjectOf<S>, false> {
  return schema(
    value => {
      if (!isPlainObject(value)) return expected('object', value);
      const output: Record<string, unknown> = {};
      const issues: Issue[] = [];
      for (const [key, field] of Object.entries(shape)) {
        const result = field['~standard'].validate(value[key]);
        if (result.issues) {
          for (const issue of result.issues)
            issues.push({ ...issue, path: [key, ...(issue.path ?? [])] });
        } else if (key in value) {
          output[key] = result.value;
        }
      }
      return issues.length > 0 ? { issues } : ok(output as ObjectOf<S>);
    },
    () => {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(shape)) {
        properties[key] = field.toJsonSchema();
        if (!field.optional) required.push(key);
      }
      return { type: 'object', properties, ...(required.length > 0 && { required }) };
    },
  );
}

/** Return values that need no check, typed as `T`. */
export const unchecked = <T>(): Schema<T, false> =>
  schema(
    value => ok(value as T),
    () => ({}),
  );

/** `undefined`: what a function that returns nothing returns. */
export const nothing = (): Schema<void, false> =>
  schema(
    value => (value === undefined ? ok(value) : expected('void', value)),
    () => ({}),
  );
