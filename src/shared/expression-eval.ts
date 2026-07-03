/**
 * expression-eval — pure arithmetic expression evaluator for named user
 * parameters (Phase-3 parametric modeling, Fusion "User Parameters" pattern).
 *
 * Grammar (recursive descent, no eval/Function — CLAUDE.md Safety Rule 4):
 *
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/') factor)*
 *   factor     := ('-' | '+') factor | primary
 *   primary    := NUMBER | IDENTIFIER | '(' expression ')'
 *
 * Identifiers resolve against the caller-supplied variable map (other user
 * parameters). Every failure mode returns a structured error — this module
 * never throws on operator input, because a typo in a parameter expression
 * must surface as an inline row error, not a crash.
 *
 * `resolveParameters` evaluates a whole parameter list in dependency order
 * (a parameter may reference any other, regardless of declaration order) and
 * detects reference cycles, reporting each offending parameter individually
 * so one bad row never poisons the rest of the table.
 */

/** A named user parameter definition: `name = expression`. */
export interface UserParameterDef {
  readonly name: string
  readonly expression: string
}

export type ExpressionResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: string }

/** Names must be code-like identifiers so they can appear inside expressions. */
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Is `name` usable as a user-parameter name? */
export function isValidParameterName(name: string): boolean {
  return IDENTIFIER_RE.test(name)
}

type Token =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'ident'; readonly name: string }
  | { readonly kind: 'op'; readonly op: '+' | '-' | '*' | '/' }
  | { readonly kind: 'lparen' }
  | { readonly kind: 'rparen' }

function tokenize(expr: string): Token[] | { readonly error: string } {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]!
    if (ch === ' ' || ch === '\t') {
      i++
      continue
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ kind: 'op', op: ch })
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen' })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' })
      i++
      continue
    }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let j = i
      while (j < expr.length && ((expr[j]! >= '0' && expr[j]! <= '9') || expr[j] === '.')) j++
      const raw = expr.slice(i, j)
      const value = Number(raw)
      if (!Number.isFinite(value)) return { error: `Invalid number '${raw}'` }
      tokens.push({ kind: 'number', value })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j]!)) j++
      tokens.push({ kind: 'ident', name: expr.slice(i, j) })
      i = j
      continue
    }
    return { error: `Unexpected character '${ch}'` }
  }
  return tokens
}

/**
 * Extract every identifier referenced by `expression`. Used by
 * {@link resolveParameters} to build the dependency graph. A syntactically
 * broken expression contributes no references (its own evaluation reports
 * the error).
 */
export function referencedNames(expression: string): readonly string[] {
  const tokens = tokenize(expression)
  if (!Array.isArray(tokens)) return []
  const seen = new Set<string>()
  for (const t of tokens) {
    if (t.kind === 'ident') seen.add(t.name)
  }
  return [...seen]
}

/**
 * Evaluate a single arithmetic expression against a variable map.
 * Pure; never throws. Non-finite results (division by zero, overflow)
 * report an error rather than leaking Infinity/NaN into the sketch solver.
 */
export function evaluateExpression(
  expression: string,
  vars: Readonly<Record<string, number>> = {}
): ExpressionResult {
  const trimmed = expression.trim()
  if (trimmed.length === 0) return { ok: false, error: 'Empty expression' }
  const tokens = tokenize(trimmed)
  if (!Array.isArray(tokens)) return { ok: false, error: tokens.error }
  if (tokens.length === 0) return { ok: false, error: 'Empty expression' }

  let pos = 0
  let failure: string | null = null
  const fail = (msg: string): number => {
    if (failure === null) failure = msg
    return NaN
  }

  const parseExpression = (): number => {
    let value = parseTerm()
    while (failure === null && pos < tokens.length) {
      const t = tokens[pos]!
      if (t.kind !== 'op' || (t.op !== '+' && t.op !== '-')) break
      pos++
      const rhs = parseTerm()
      value = t.op === '+' ? value + rhs : value - rhs
    }
    return value
  }

  const parseTerm = (): number => {
    let value = parseFactor()
    while (failure === null && pos < tokens.length) {
      const t = tokens[pos]!
      if (t.kind !== 'op' || (t.op !== '*' && t.op !== '/')) break
      pos++
      const rhs = parseFactor()
      value = t.op === '*' ? value * rhs : value / rhs
    }
    return value
  }

  const parseFactor = (): number => {
    const t = tokens[pos]
    if (t === undefined) return fail('Unexpected end of expression')
    if (t.kind === 'op' && (t.op === '-' || t.op === '+')) {
      pos++
      const v = parseFactor()
      return t.op === '-' ? -v : v
    }
    return parsePrimary()
  }

  const parsePrimary = (): number => {
    const t = tokens[pos]
    if (t === undefined) return fail('Unexpected end of expression')
    if (t.kind === 'number') {
      pos++
      return t.value
    }
    if (t.kind === 'ident') {
      pos++
      const v = vars[t.name]
      if (v === undefined) return fail(`Unknown parameter '${t.name}'`)
      return v
    }
    if (t.kind === 'lparen') {
      pos++
      const v = parseExpression()
      const close = tokens[pos]
      if (close === undefined || close.kind !== 'rparen') return fail("Missing ')'")
      pos++
      return v
    }
    if (t.kind === 'rparen') return fail("Unexpected ')'")
    return fail(`Unexpected '${t.op}'`)
  }

  const value = parseExpression()
  if (failure === null && pos < tokens.length) {
    const t = tokens[pos]!
    failure =
      t.kind === 'number'
        ? `Unexpected number after expression`
        : t.kind === 'ident'
          ? `Unexpected identifier '${t.name}'`
          : t.kind === 'op'
            ? `Unexpected '${t.op}'`
            : t.kind === 'rparen'
              ? "Unexpected ')'"
              : "Unexpected '('"
  }
  if (failure !== null) return { ok: false, error: failure }
  if (!Number.isFinite(value)) return { ok: false, error: 'Result is not a finite number' }
  return { ok: true, value }
}

/** Outcome of resolving a full user-parameter list. */
export interface ResolvedParameters {
  /** Successfully resolved `name → numeric value` (every non-error row). */
  readonly values: Readonly<Record<string, number>>
  /** Per-parameter failure messages (`name → error`) for the rows that did not resolve. */
  readonly errors: Readonly<Record<string, string>>
}

/**
 * Resolve every parameter in `params`, honoring cross-references in ANY
 * declaration order and detecting cycles. Each parameter fails independently:
 * a row whose expression is broken (or participates in a cycle, or references
 * a broken row) lands in `errors`; everything else still resolves in `values`.
 */
export function resolveParameters(params: ReadonlyArray<UserParameterDef>): ResolvedParameters {
  const values: Record<string, number> = {}
  const errors: Record<string, string> = {}
  const byName = new Map<string, UserParameterDef>()
  for (const p of params) {
    if (byName.has(p.name)) {
      errors[p.name] = `Duplicate parameter name '${p.name}'`
      continue
    }
    byName.set(p.name, p)
  }

  // DFS states: undefined = unvisited, 'visiting' = on the current stack
  // (seeing it again is a cycle), 'done' = settled into values or errors.
  const state = new Map<string, 'visiting' | 'done'>()

  const resolveOne = (name: string, stack: readonly string[]): void => {
    if (state.get(name) === 'done') return
    if (state.get(name) === 'visiting') {
      // Report the cycle on every member currently on the stack from `name`.
      const start = stack.indexOf(name)
      const cycle = [...stack.slice(start), name]
      for (const member of cycle.slice(0, -1)) {
        if (errors[member] === undefined) {
          errors[member] = `Circular reference: ${cycle.join(' → ')}`
        }
        state.set(member, 'done')
      }
      return
    }
    const def = byName.get(name)
    if (def === undefined) return // unknown ref — evaluation reports it
    state.set(name, 'visiting')
    for (const ref of referencedNames(def.expression)) {
      if (byName.has(ref)) resolveOne(ref, [...stack, name])
    }
    // A cycle report above may have already settled this parameter.
    if (errors[name] !== undefined) {
      state.set(name, 'done')
      return
    }
    const result = evaluateExpression(def.expression, values)
    if (result.ok) {
      values[name] = result.value
    } else {
      errors[name] = result.error
    }
    state.set(name, 'done')
  }

  for (const p of byName.keys()) resolveOne(p, [])
  return { values, errors }
}
