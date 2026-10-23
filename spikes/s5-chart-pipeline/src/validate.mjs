// Minimal JSON Schema (2020-12) subset validator for tests: type, const, enum, pattern,
// minLength, minimum, maximum, exclusiveMinimum, required, properties, items, minItems, $ref (#/...).
export function validate(schema, value, root = schema, path = '$') {
  const errors = [];
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o[k], root);
    return validate(target, value, root, path);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const ok = types.some((t) => t === actual || (t === 'integer' && Number.isInteger(value)));
    if (!ok) return [`${path}: expected ${types.join('|')}, got ${actual}`];
  }
  if ('const' in schema && value !== schema.const) errors.push(`${path}: expected ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${value} not in enum`);
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: "${value}" !~ ${schema.pattern}`);
    if (schema.minLength && value.length < schema.minLength) errors.push(`${path}: too short`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: < ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: > ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${path}: <= ${schema.exclusiveMinimum}`);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required || []) if (!(k in value)) errors.push(`${path}: missing ${k}`);
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in value) errors.push(...validate(s, value[k], root, `${path}.${k}`));
  }
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, root, `${path}[${i}]`)));
  }
  return errors;
}
