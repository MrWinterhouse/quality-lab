import { readFileSync } from 'node:fs';

export type JsonSchema = any;

const spec = JSON.parse(
  readFileSync(new URL('../../quality/openapi.json', import.meta.url), 'utf8'),
);

export function getSpec() {
  return spec;
}

function resolve(schema: JsonSchema): JsonSchema {
  if (schema && typeof schema === 'object' && typeof schema.$ref === 'string') {
    const name = schema.$ref.split('/').pop();
    const resolved = spec.components.schemas[name];
    if (!resolved) throw new Error(`Unknown schema ref ${schema.$ref}`);
    return resolved;
  }
  return schema;
}

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

export function validateAgainst(value: unknown, schema: JsonSchema, path = '$'): string[] {
  const resolved = resolve(schema);
  if (!resolved) return [];
  const errors: string[] = [];

  if (resolved.oneOf) {
    const matches = resolved.oneOf.filter(
      (option: JsonSchema) => validateAgainst(value, option, path).length === 0,
    );
    if (matches.length !== 1) errors.push(`${path}: matched ${matches.length} oneOf branches`);
    return errors;
  }

  if (resolved.type) {
    const types = Array.isArray(resolved.type) ? resolved.type : [resolved.type];
    if (!types.some((type: string) => typeMatches(value, type))) {
      errors.push(`${path}: expected ${types.join('|')}, received ${Array.isArray(value) ? 'array' : typeof value}`);
      return errors;
    }
  }

  if (resolved.enum && !resolved.enum.some((item: unknown) => JSON.stringify(item) === JSON.stringify(value))) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(resolved.enum)}`);
  }

  if (typeof value === 'number') {
    if (resolved.minimum !== undefined && value < resolved.minimum) {
      errors.push(`${path}: ${value} below minimum ${resolved.minimum}`);
    }
    if (resolved.maximum !== undefined && value > resolved.maximum) {
      errors.push(`${path}: ${value} above maximum ${resolved.maximum}`);
    }
  }

  if (typeof value === 'string' && resolved.format === 'date-time' && Number.isNaN(Date.parse(value))) {
    errors.push(`${path}: ${value} is not a date-time`);
  }
  if (typeof value === 'string' && resolved.format === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
      errors.push(`${path}: ${value} is not a date`);
    }
  }

  if (resolved.type === 'object' || (resolved.properties && typeof value === 'object')) {
    const object = value as Record<string, unknown>;
    for (const required of resolved.required ?? []) {
      if (!(required in object)) errors.push(`${path}.${required}: required property missing`);
    }
    for (const [key, childSchema] of Object.entries(resolved.properties ?? {})) {
      if (key in object) errors.push(...validateAgainst(object[key], childSchema, `${path}.${key}`));
    }
  }

  if (resolved.type === 'array' && resolved.items && Array.isArray(value)) {
    value.forEach((item, index) => {
      errors.push(...validateAgainst(item, resolved.items, `${path}[${index}]`));
    });
  }

  return errors;
}

export function responseSchema(path: string, method: string, status: number) {
  const entry = spec.paths[path]?.[method]?.responses?.[String(status)];
  return entry?.content?.['application/json']?.schema;
}
