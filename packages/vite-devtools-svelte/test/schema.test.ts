import { describe, expect, it } from 'vitest';

import * as v from '../src/schema.js';

const issues = (schema: v.Schema, value: unknown) => {
  const result = schema['~standard'].validate(value);
  return result.issues?.map(i => [i.path?.join('.') ?? '', i.message]);
};

// MCP clients read these messages.
describe('messages', () => {
  it.each<[string, v.Schema, unknown, string[]]>([
    ['string type', v.string(), 1, ['Invalid input: expected string, received number']],
    ['string min', v.string({ min: 1 }), '', ['Too small: expected string to have >=1 characters']],
    [
      'string max',
      v.string({ max: 3 }),
      'abcd',
      ['Too big: expected string to have <=3 characters'],
    ],
    [
      'string test after max',
      v.string({ max: 1, test: value => value === 'a', message: 'not a session id' }),
      'bb',
      ['Too big: expected string to have <=1 characters', 'not a session id'],
    ],
    ['number type', v.number(), null, ['Invalid input: expected number, received null']],
    ['NaN', v.number(), Number.NaN, ['Invalid input: expected number, received NaN']],
    ['-Infinity', v.number(), -Infinity, ['Invalid input: expected number, received -Infinity']],
    ['positive', v.number({ positive: true }), 0, ['Too small: expected number to be >0']],
    ['min', v.number({ min: 1 }), 0, ['Too small: expected number to be >=1']],
    ['max', v.number({ max: 120 }), 121, ['Too big: expected number to be <=120']],
    ['int', v.integer({ min: 1 }), -1.5, ['Invalid input: expected int, received number']],
    [
      'unsafe int',
      v.integer({ max: 200 }),
      2 ** 60,
      ['Too big: expected int to be <=9007199254740991', 'Too big: expected number to be <=200'],
    ],
    ['boolean', v.boolean(), 'yes', ['Invalid input: expected boolean, received string']],
    ['oneOf', v.oneOf(['a', 'b']), 'c', ['Invalid option: expected one of "a"|"b"']],
    ['nothing', v.nothing(), null, ['Invalid input: expected void, received null']],
    ['object type', v.object({}), [], ['Invalid input: expected object, received array']],
  ])('%s', (_, schema, value, messages) => {
    expect(issues(schema, value)).toEqual(messages.map(m => ['', m]));
  });

  it('prefixes object issues with their key, in shape order', () => {
    const schema = v.object({ a: v.string(), b: v.object({ c: v.boolean() }) });
    expect(issues(schema, { b: { c: 1 } })).toEqual([
      ['a', 'Invalid input: expected string, received undefined'],
      ['b.c', 'Invalid input: expected boolean, received number'],
    ]);
  });
});

describe('values', () => {
  it('keeps only the keys of the shape that were given', () => {
    const schema = v.object({ a: v.string(), b: v.optional(v.integer()) });
    expect(schema['~standard'].validate({ a: 'x', extra: 1 })).toEqual({ value: { a: 'x' } });
  });

  it('lets an optional key be left out and unchecked take anything', () => {
    const schema = v.object({ a: v.optional(v.string()) });
    expect(schema['~standard'].validate({})).toEqual({ value: {} });
    expect(v.unchecked()['~standard'].validate(null)).toEqual({ value: null });
  });
});

// The mcp-wire snapshot pins this for every tool.
describe('toJsonSchema', () => {
  it('describes an object of every kind', () => {
    expect(
      v
        .object({
          str: v.string({ min: 1, max: 3 }),
          num: v.optional(v.number({ min: 0 })),
          pos: v.optional(v.number({ positive: true })),
          int: v.integer(),
          posInt: v.optional(v.integer({ positive: true })),
          bool: v.optional(v.boolean()),
          keep: v.optional(v.oneOf(['a', 'b'])),
        })
        .toJsonSchema(),
    ).toEqual({
      type: 'object',
      properties: {
        str: { type: 'string', minLength: 1, maxLength: 3 },
        num: { type: 'number', minimum: 0 },
        pos: { type: 'number', exclusiveMinimum: 0 },
        int: { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 },
        posInt: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
        bool: { type: 'boolean' },
        keep: { type: 'string', enum: ['a', 'b'] },
      },
      required: ['str', 'int'],
    });
  });

  it('leaves out required when every key is optional', () => {
    expect(v.object({ a: v.optional(v.string()) }).toJsonSchema()).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
    });
  });
});
