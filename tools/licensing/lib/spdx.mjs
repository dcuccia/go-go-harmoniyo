// SPDX license-expression evaluation against an allowlist. Supports AND, OR, WITH and parentheses.
// OR is satisfied when any branch is allowed; AND needs every branch.
export function parseSpdx(expr) {
  const tokens = expr.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').split(/\s+/).filter(Boolean);
  let i = 0;
  const peek = () => tokens[i];
  const primary = () => {
    if (peek() === '(') {
      i++;
      const node = orExpr();
      if (tokens[i++] !== ')') throw new Error(`Unbalanced parentheses in "${expr}"`);
      return node;
    }
    const id = tokens[i++];
    if (!id || /^(AND|OR|WITH|\))$/.test(id)) throw new Error(`Bad SPDX expression "${expr}"`);
    if (peek() === 'WITH') {
      i++;
      return { id, exception: tokens[i++] };
    }
    return { id };
  };
  const andExpr = () => {
    const parts = [primary()];
    while (peek() === 'AND') i++, parts.push(primary());
    return parts.length === 1 ? parts[0] : { and: parts };
  };
  const orExpr = () => {
    const parts = [andExpr()];
    while (peek() === 'OR') i++, parts.push(andExpr());
    return parts.length === 1 ? parts[0] : { or: parts };
  };
  const tree = orExpr();
  if (i !== tokens.length) throw new Error(`Trailing tokens in SPDX expression "${expr}"`);
  return tree;
}

/** True when the expression can be satisfied using only allowed ids (WITH exceptions are not allowed implicitly). */
export function isAllowed(expr, allowed) {
  const ok = (n) => (n.or ? n.or.some(ok) : n.and ? n.and.every(ok) : !n.exception && allowed.has(n.id));
  return ok(parseSpdx(expr));
}

/** Every license id referenced by an expression. */
export function idsOf(expr) {
  const ids = new Set();
  const walk = (n) => (n.or ? n.or.forEach(walk) : n.and ? n.and.forEach(walk) : ids.add(n.id));
  walk(parseSpdx(expr));
  return [...ids];
}

/** Normalizes legacy npm license fields ({type}, [{type}], "(MIT OR X)") to an SPDX expression string. */
export function normalizeNpmLicense(license) {
  if (!license) return null;
  if (typeof license === 'string') return license.trim();
  if (Array.isArray(license)) return license.map(normalizeNpmLicense).filter(Boolean).join(' OR ') || null;
  if (typeof license === 'object' && license.type) return String(license.type).trim();
  return null;
}
