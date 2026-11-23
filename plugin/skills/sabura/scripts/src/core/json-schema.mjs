// Copied from src/core/json-schema.js by scripts/build-plugin.js (sabura-app/sabura-editor, MIT). Do not edit.
/**
 * Checks values against the JSON Schemas the agent API publishes.
 *
 * Supports exactly the keywords those schemas use. Any other keyword throws, so
 * a schema can never promise a rule this checker silently skips. Pure: no I/O.
 */

export const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  'type', 'const', 'enum', 'description',
  'properties', 'patternProperties', 'additionalProperties', 'required', 'minProperties',
  'items', 'prefixItems', 'minItems', 'maxItems', 'uniqueItems',
  'minLength', 'minimum', 'maximum', 'exclusiveMinimum',
  'oneOf', 'anyOf'
]);

const isSchemaObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function schemaTypeMatches(value, type) {
  switch (type) {
    case 'object': return isSchemaObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isInteger(value);
    default: throw new Error(`Unsupported JSON Schema type "${type}"`);
  }
}

const describeSchemaValue = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

/**
 * @param {*} value
 * @param {object} schema
 * @param {string} [path] where `value` sits, used in messages
 * @returns {{path: string, message: string}[]} empty when the value conforms
 */
export function checkJsonSchema(value, schema, path = '') {
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) throw new Error(`Unsupported JSON Schema keyword "${keyword}"`);
  }
  const at = path || 'value';
  const fail = (message, where = at) => [{ path: where, message }];

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => schemaTypeMatches(value, t))) return fail(`${at} must be ${types.join(' or ')}, got ${describeSchemaValue(value)}`);
  }
  if ('const' in schema && value !== schema.const) return fail(`${at} must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) return fail(`${at} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);

  if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) {
    return fail(`${at} must not be empty`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return fail(`${at} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) return fail(`${at} must be at most ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return fail(`${at} must be greater than ${schema.exclusiveMinimum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return fail(`${at} needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return fail(`${at} allows at most ${schema.maxItems} item(s)`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) return fail(`${at} must not repeat items`);
    const prefix = schema.prefixItems || [];
    for (let i = 0; i < value.length; i++) {
      const itemSchema = i < prefix.length ? prefix[i] : schema.items;
      if (!itemSchema) continue;
      const errors = checkJsonSchema(value[i], itemSchema, `${at}[${i}]`);
      if (errors.length) return errors;
    }
  }

  if (isSchemaObject(value)) {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) {
        // Name any fields the schema does not know: usually the misspelling.
        const unknown = schema.additionalProperties === false
          ? Object.keys(value).filter((k) => !Object.hasOwn(schema.properties || {}, k)
            && !Object.keys(schema.patternProperties || {}).some((pattern) => new RegExp(pattern, 'u').test(k)))
          : [];
        return fail(`${at}.${key} is required${unknown.length ? ` (unknown field: ${unknown.join(', ')})` : ''}`, `${at}.${key}`);
      }
    }
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) return fail(`${at} must not be empty`);
    const properties = schema.properties || {};
    const patterns = Object.entries(schema.patternProperties || {}).map(([pattern, sub]) => [new RegExp(pattern, 'u'), sub]);
    for (const key of keys) {
      const where = `${at}.${key}`;
      const matchedPatterns = patterns.filter(([regex]) => regex.test(key));
      if (Object.hasOwn(properties, key)) {
        const errors = checkJsonSchema(value[key], properties[key], where);
        if (errors.length) return errors;
      }
      for (const [, sub] of matchedPatterns) {
        const errors = checkJsonSchema(value[key], sub, where);
        if (errors.length) return errors;
      }
      if (!Object.hasOwn(properties, key) && matchedPatterns.length === 0) {
        if (schema.additionalProperties === false) {
          const allowed = Object.keys(properties).filter((k) => !Object.hasOwn(value, k));
          return fail(`${where} is not allowed${allowed.length ? ` (allowed: ${allowed.join(', ')})` : ''}`, where);
        }
        if (isSchemaObject(schema.additionalProperties)) {
          const errors = checkJsonSchema(value[key], schema.additionalProperties, where);
          if (errors.length) return errors;
        }
      }
    }
  }

  if (schema.anyOf) {
    const results = schema.anyOf.map((branch) => checkJsonSchema(value, branch, path));
    if (!results.some((errors) => errors.length === 0)) return closestSchemaBranch(value, schema.anyOf, results);
  }
  if (schema.oneOf) {
    const results = schema.oneOf.map((branch) => checkJsonSchema(value, branch, path));
    const passing = results.filter((errors) => errors.length === 0).length;
    if (passing === 0) return closestSchemaBranch(value, schema.oneOf, results);
    if (passing > 1) return fail(`${at} matches more than one allowed shape`);
  }
  return [];
}

/**
 * Of several failing alternatives, report the most useful one. When the value
 * has a `type` that exactly one branch accepts (create_object's rectangle, text,
 * path...), that branch's error is the real one. Otherwise report the error
 * deepest in the value, since that branch got furthest.
 */
function closestSchemaBranch(value, branches, results) {
  if (isSchemaObject(value) && 'type' in value) {
    const accepting = branches
      .map((branch, i) => [branch.properties?.type, i])
      .filter(([typeSchema]) => typeSchema && checkJsonSchema(value.type, typeSchema).length === 0);
    if (accepting.length === 1) return results[accepting[0][1]];
  }
  const depth = (errors) => errors[0].path.split(/[.[]/).length;
  return results.reduce((best, errors) => (depth(errors) > depth(best) ? errors : best));
}
