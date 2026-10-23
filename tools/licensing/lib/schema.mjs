// Minimal JSON Schema (2020-12 subset) validator for the asset register, so the tools stay
// dependency-free. Supports: $ref (local #/$defs/...), type, const, enum, pattern, minLength,
// minItems, uniqueItems, required, properties, additionalProperties (boolean or schema), items,
// allOf, anyOf, if/then/else, format "date" and "uri". Unsupported keywords throw, so the schema
// can't silently promise more than is checked.
const KNOWN = new Set([
  '$schema', '$id', '$comment', '$defs', '$ref', 'title', 'description', 'examples', 'default',
  'type', 'const', 'enum', 'pattern', 'minLength', 'minItems', 'uniqueItems', 'required',
  'properties', 'additionalProperties', 'items', 'allOf', 'anyOf', 'if', 'then', 'else', 'format',
]);

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);

export function validate(root, value) {
  const errors = [];
  const resolveRef = (ref) => {
    if (!ref.startsWith('#/')) throw new Error(`Only local $ref supported: ${ref}`);
    return ref.slice(2).split('/').reduce((node, key) => node[key], root);
  };
  const check = (schema, v, path) => {
    const before = errors.length;
    for (const k of Object.keys(schema)) if (!KNOWN.has(k)) throw new Error(`Unsupported schema keyword "${k}" at ${path}`);
    if (schema.$ref) check(resolveRef(schema.$ref), v, path);
    const t = typeOf(v);
    if (schema.type) {
      const types = [].concat(schema.type);
      if (!types.some((x) => x === t || (x === 'number' && t === 'integer'))) {
        errors.push(`${path}: expected ${types.join('|')}, got ${t}`);
        return false;
      }
    }
    if ('const' in schema && JSON.stringify(v) !== JSON.stringify(schema.const)) errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
    if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) errors.push(`${path}: must be one of ${schema.enum.join(', ')}`);
    if (t === 'string') {
      if (schema.minLength != null && v.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
      if (schema.pattern && !new RegExp(schema.pattern, 'u').test(v)) errors.push(`${path}: "${v}" does not match ${schema.pattern}`);
      if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors.push(`${path}: not a YYYY-MM-DD date`);
      if (schema.format === 'uri' && !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(v)) errors.push(`${path}: not an absolute URI`);
    }
    if (t === 'array') {
      if (schema.minItems != null && v.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems} item(s)`);
      if (schema.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) errors.push(`${path}: items must be unique`);
      if (schema.items) v.forEach((x, i) => check(schema.items, x, `${path}[${i}]`));
    }
    if (t === 'object') {
      for (const r of schema.required ?? []) if (!(r in v)) errors.push(`${path}: missing required "${r}"`);
      const props = schema.properties ?? {};
      for (const [k, x] of Object.entries(v)) {
        if (k in props) check(props[k], x, `${path}.${k}`);
        else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property "${k}"`);
        else if (typeof schema.additionalProperties === 'object') check(schema.additionalProperties, x, `${path}.${k}`);
      }
    }
    for (const s of schema.allOf ?? []) check(s, v, path);
    if (schema.anyOf) {
      const ok = schema.anyOf.some((s) => validate({ ...s, $defs: root.$defs }, v).length === 0);
      if (!ok) errors.push(`${path}: does not match any allowed shape`);
    }
    if (schema.if) {
      const matches = validate({ ...schema.if, $defs: root.$defs }, v).length === 0;
      if (matches && schema.then) check(schema.then, v, path);
      if (!matches && schema.else) check(schema.else, v, path);
    }
    return errors.length === before;
  };
  check(root, value, '$');
  return errors;
}
