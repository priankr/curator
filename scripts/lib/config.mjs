import { readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function matchesType(v, t) {
  switch (t) {
    case 'null': return v === null;
    case 'array': return Array.isArray(v);
    case 'object': return isObject(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    default: return false;
  }
}

const TYPE_WORDS = { null: 'null', array: 'a list', object: 'an object', number: 'a number', integer: 'a whole number', string: 'a string', boolean: 'true or false' };

const join = (path, key) => (path ? `${path}.${key}` : key);

// Returns the first failing local keyword message, or null when the value passes this node alone.
function localProblem(value, schema) {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) return `must be ${types.map((t) => TYPE_WORDS[t]).join(' or ')}`;
  }
  if (schema.enum && !schema.enum.includes(value)) return `must be one of ${schema.enum.join(', ')}`;
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) return 'must not be empty';
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) return 'is not in the expected format';
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return `must be at least ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `must be at most ${schema.maximum}`;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return `must have at least ${schema.minItems} items`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `must have at most ${schema.maxItems} items`;
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) return 'must not repeat items';
  }
  if (schema.anyOf && !schema.anyOf.some((s) => validateNode(value, s, '').length === 0)) return 'does not match any allowed form';
  return null;
}

function validateNode(value, schema, path) {
  const problem = localProblem(value, schema);
  if (problem) return [`${path || 'config'} ${schema.message ?? problem}`];
  const errors = [];
  if (isObject(value)) {
    const props = schema.properties ?? {};
    for (const key of Object.keys(value)) {
      if (props[key]) errors.push(...validateNode(value[key], props[key], join(path, key)));
      else if (isObject(schema.additionalProperties)) errors.push(...validateNode(value[key], schema.additionalProperties, join(path, key)));
      else if (schema.additionalProperties === false) errors.push(`${join(path, key)} is not a known setting`);
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${join(path, key)} is required`);
    }
    // A missing object that holds required keys is checked as empty so the required keys are named.
    for (const [key, sub] of Object.entries(props)) {
      if (!(key in value) && sub.type === 'object' && hasRequired(sub)) errors.push(...validateNode({}, sub, join(path, key)));
    }
  } else if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...validateNode(item, schema.items, `${path}[${i}]`)));
  }
  return errors;
}

function hasRequired(schema) {
  if (schema.required?.length) return true;
  return Object.values(schema.properties ?? {}).some((s) => s.type === 'object' && hasRequired(s));
}

export function validateConfig(obj, schema) {
  return validateNode(obj, schema, '');
}

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function resolveNode(value, schema) {
  if (schema.properties && (value === undefined || isObject(value))) {
    const out = {};
    for (const [key, sub] of Object.entries(schema.properties)) {
      const r = resolveNode(value?.[key], sub);
      if (r !== undefined) out[key] = r;
    }
    for (const key of Object.keys(value ?? {})) {
      if (!(key in schema.properties)) out[key] = clone(value[key]);
    }
    return out;
  }
  if (value !== undefined) return clone(value);
  return clone(schema.default);
}

export function resolveConfig(obj, schema) {
  return resolveNode(obj, schema);
}

const fromRoot = (p) => (isAbsolute(p) ? p : resolvePath(ROOT, p));

export function loadConfig(path = 'curator.config.json', schemaPath = 'src/config.schema.json') {
  const file = fromRoot(path);
  const name = basename(file);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { config: null, errors: [`${name} was not found`] };
    return { config: null, errors: [`${name} could not be read: ${err.message}`] };
  }
  let obj;
  try {
    obj = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    return { config: null, errors: [`${name} is not valid JSON: ${err.message}`] };
  }
  const schema = JSON.parse(readFileSync(fromRoot(schemaPath), 'utf8'));
  const errors = validateConfig(obj, schema);
  return { config: errors.length ? null : resolveConfig(obj, schema), errors };
}
