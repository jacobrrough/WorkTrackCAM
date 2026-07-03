/**
 * expression-eval — a pure, hand-rolled arithmetic-expression engine for USER
 * PARAMETERS (Fusion's Parameters dialog: `thickness = 6`, `width = d1*2 + 5`).
 *
 * DESIGN CONTRACT (why hand-rolled, why errors-as-values):
 *   - NO `eval` / `new Function` — the sidecar security posture rejects dynamic
 *     code everywhere (engines/sidecar BANNED_TOKENS); the design file is a
 *     saved-project artefact, so an expression string must never be able to run
 *     arbitrary JS. This is a deterministic tokenizer → recursive-descent parser
 *     → AST → tree-walk evaluator. Pure, no I/O, no globals, no `Math` surface
 *     beyond `**`.
 *   - ERRORS ARE VALUES, NOT THROWS. Every failure (empty string, syntax error,
 *     unknown identifier, division by zero, a non-finite result, or a reference
 *     cycle) is returned as a tagged {@link EvalResult}. The Parameters panel
 *     renders the message inline next to the offending row; a bad expression
 *     never crashes a render or a solve.
 *   - DETERMINISTIC. Same input → same output, so the whole thing is trivially
 *     unit-testable and the resolved-value cache in the design file is stable.
 *
 * GRAMMAR (standard precedence, `^` == `**` right-associative, unary minus):
 *
 *   expr    := add
 *   add     := mul ( ('+' | '-') mul )*
 *   mul     := unary ( ('*' | '/') unary )*
 *   unary   := ('+' | '-') unary | power
 *   power   := primary ( '^' unary )?          // right-assoc: 2^3^2 == 2^(3^2)
 *   primary := NUMBER | IDENT | '(' expr ')'
 *
 * Only `+ - * / ^`, parentheses, unary +/-, numeric literals, and identifier
 * references are supported. No function calls, no comparison, no strings — a
 * length/angle parameter is a pure real number (mm or degrees; the unit lives in
 * the consuming dimension, not the expression).
 */

// ---------------------------------------------------------------------------
// Public result type — errors are values.
// ---------------------------------------------------------------------------

/** Every distinct way evaluating a single expression can fail. */
export type EvalErrorKind =
  | 'empty'
  | 'syntax'
  | 'unknown_identifier'
  | 'division_by_zero'
  | 'non_finite'

/** Success or a tagged failure. Never thrown — always returned. */
export type EvalResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: EvalErrorKind; readonly message: string }

function ok(value: number): EvalResult {
  return { ok: true, value }
}
function err(error: EvalErrorKind, message: string): EvalResult {
  return { ok: false, error, message }
}

// ---------------------------------------------------------------------------
// Identifier rules — shared with the schema (a user-parameter name IS an
// identifier). Kept here so the tokenizer and the name-validation agree byte
// for byte.
// ---------------------------------------------------------------------------

/** A valid parameter/identifier name: letter or `_`, then letters/digits/`_`. */
export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** True when `name` is a syntactically valid parameter identifier. */
export function isValidIdentifier(name: string): boolean {
  return IDENTIFIER_RE.test(name)
}

// ---------------------------------------------------------------------------
// Tokenizer.
// ---------------------------------------------------------------------------

type TokenType =
  | 'number'
  | 'ident'
  | 'plus'
  | 'minus'
  | 'star'
  | 'slash'
  | 'caret'
  | 'lparen'
  | 'rparen'

interface Token {
  readonly type: TokenType
  /** Numeric value (number tokens) or identifier text (ident tokens). */
  readonly value: number | string
  /** Source column (0-based) — used only for message context. */
  readonly pos: number
}

/** A tokenizer failure carries the same errors-as-values contract. */
type TokenizeResult = { ok: true; tokens: Token[] } | { ok: false; result: EvalResult }

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}
function isIdentStart(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_'
}
function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch)
}

function tokenize(src: string): TokenizeResult {
  const tokens: Token[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const ch = src[i]!
    // Whitespace (space, tab, newline) is insignificant between tokens.
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1
      continue
    }
    const start = i
    switch (ch) {
      case '+':
        tokens.push({ type: 'plus', value: '+', pos: start })
        i += 1
        continue
      case '-':
        tokens.push({ type: 'minus', value: '-', pos: start })
        i += 1
        continue
      case '*':
        // Accept `**` as a synonym for `^` (Fusion + Python both use it).
        if (src[i + 1] === '*') {
          tokens.push({ type: 'caret', value: '^', pos: start })
          i += 2
          continue
        }
        tokens.push({ type: 'star', value: '*', pos: start })
        i += 1
        continue
      case '/':
        tokens.push({ type: 'slash', value: '/', pos: start })
        i += 1
        continue
      case '^':
        tokens.push({ type: 'caret', value: '^', pos: start })
        i += 1
        continue
      case '(':
        tokens.push({ type: 'lparen', value: '(', pos: start })
        i += 1
        continue
      case ')':
        tokens.push({ type: 'rparen', value: ')', pos: start })
        i += 1
        continue
      default:
        break
    }
    if (isDigit(ch) || ch === '.') {
      // Number literal: digits, one optional '.', optional exponent (e/E [+-]? digits).
      let j = i
      let seenDot = false
      let seenExp = false
      while (j < n) {
        const c = src[j]!
        if (isDigit(c)) {
          j += 1
          continue
        }
        if (c === '.' && !seenDot && !seenExp) {
          seenDot = true
          j += 1
          continue
        }
        if ((c === 'e' || c === 'E') && !seenExp && j > i) {
          seenExp = true
          j += 1
          // Optional sign directly after the exponent marker.
          if (src[j] === '+' || src[j] === '-') j += 1
          continue
        }
        break
      }
      const text = src.slice(i, j)
      const num = Number(text)
      if (!Number.isFinite(num)) {
        return { ok: false, result: err('syntax', `Invalid number "${text}"`) }
      }
      tokens.push({ type: 'number', value: num, pos: start })
      i = j
      continue
    }
    if (isIdentStart(ch)) {
      let j = i + 1
      while (j < n && isIdentPart(src[j]!)) j += 1
      tokens.push({ type: 'ident', value: src.slice(i, j), pos: start })
      i = j
      continue
    }
    return { ok: false, result: err('syntax', `Unexpected character "${ch}"`) }
  }
  return { ok: true, tokens }
}

// ---------------------------------------------------------------------------
// AST.
// ---------------------------------------------------------------------------

type Node =
  | { kind: 'num'; value: number }
  | { kind: 'ident'; name: string }
  | { kind: 'neg'; operand: Node }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: Node; right: Node }

// ---------------------------------------------------------------------------
// Recursive-descent parser. Returns either an AST or a syntax EvalResult.
// ---------------------------------------------------------------------------

type ParseResult = { ok: true; node: Node } | { ok: false; result: EvalResult }

class Parser {
  private pos = 0
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }
  private next(): Token | undefined {
    return this.tokens[this.pos++]
  }

  /** Entry point: parse a full expression and require the stream be consumed. */
  parse(): ParseResult {
    const r = this.parseAdd()
    if (!r.ok) return r
    const rest = this.peek()
    if (rest !== undefined) {
      return { ok: false, result: err('syntax', `Unexpected "${String(rest.value)}"`) }
    }
    return r
  }

  private parseAdd(): ParseResult {
    let left = this.parseMul()
    if (!left.ok) return left
    for (;;) {
      const t = this.peek()
      if (t?.type === 'plus' || t?.type === 'minus') {
        this.next()
        const right = this.parseMul()
        if (!right.ok) return right
        left = { ok: true, node: { kind: 'bin', op: t.type === 'plus' ? '+' : '-', left: left.node, right: right.node } }
      } else {
        return left
      }
    }
  }

  private parseMul(): ParseResult {
    let left = this.parseUnary()
    if (!left.ok) return left
    for (;;) {
      const t = this.peek()
      if (t?.type === 'star' || t?.type === 'slash') {
        this.next()
        const right = this.parseUnary()
        if (!right.ok) return right
        left = { ok: true, node: { kind: 'bin', op: t.type === 'star' ? '*' : '/', left: left.node, right: right.node } }
      } else {
        return left
      }
    }
  }

  private parseUnary(): ParseResult {
    const t = this.peek()
    if (t?.type === 'plus' || t?.type === 'minus') {
      this.next()
      const operand = this.parseUnary()
      if (!operand.ok) return operand
      // Unary plus is a no-op; unary minus wraps.
      return t.type === 'minus'
        ? { ok: true, node: { kind: 'neg', operand: operand.node } }
        : operand
    }
    return this.parsePower()
  }

  private parsePower(): ParseResult {
    const base = this.parsePrimary()
    if (!base.ok) return base
    const t = this.peek()
    if (t?.type === 'caret') {
      this.next()
      // Right-associative: the exponent is itself a unary (so `-` binds and
      // `2^3^2` nests to the right).
      const exp = this.parseUnary()
      if (!exp.ok) return exp
      return { ok: true, node: { kind: 'bin', op: '^', left: base.node, right: exp.node } }
    }
    return base
  }

  private parsePrimary(): ParseResult {
    const t = this.next()
    if (t === undefined) {
      return { ok: false, result: err('syntax', 'Unexpected end of expression') }
    }
    if (t.type === 'number') {
      return { ok: true, node: { kind: 'num', value: t.value as number } }
    }
    if (t.type === 'ident') {
      return { ok: true, node: { kind: 'ident', name: t.value as string } }
    }
    if (t.type === 'lparen') {
      const inner = this.parseAdd()
      if (!inner.ok) return inner
      const close = this.next()
      if (close?.type !== 'rparen') {
        return { ok: false, result: err('syntax', 'Missing closing ")"') }
      }
      return inner
    }
    return { ok: false, result: err('syntax', `Unexpected "${String(t.value)}"`) }
  }
}

// ---------------------------------------------------------------------------
// Scope + evaluation.
// ---------------------------------------------------------------------------

/** Read-only named-value scope handed to {@link evaluateExpression}. */
export type Scope = Readonly<Record<string, number>>

/** Walk the AST against `scope`. Errors (unknown ident, /0, non-finite) bubble up. */
function evalNode(node: Node, scope: Scope): EvalResult {
  switch (node.kind) {
    case 'num':
      return ok(node.value)
    case 'ident': {
      if (!Object.prototype.hasOwnProperty.call(scope, node.name)) {
        return err('unknown_identifier', `Unknown parameter "${node.name}"`)
      }
      const v = scope[node.name]!
      if (!Number.isFinite(v)) {
        return err('non_finite', `Parameter "${node.name}" is not a finite number`)
      }
      return ok(v)
    }
    case 'neg': {
      const r = evalNode(node.operand, scope)
      if (!r.ok) return r
      return ok(-r.value)
    }
    case 'bin': {
      const l = evalNode(node.left, scope)
      if (!l.ok) return l
      const r = evalNode(node.right, scope)
      if (!r.ok) return r
      let out: number
      switch (node.op) {
        case '+':
          out = l.value + r.value
          break
        case '-':
          out = l.value - r.value
          break
        case '*':
          out = l.value * r.value
          break
        case '/':
          if (r.value === 0) return err('division_by_zero', 'Division by zero')
          out = l.value / r.value
          break
        case '^':
          out = l.value ** r.value
          break
        default: {
          const _exhaustive: never = node.op
          void _exhaustive
          return err('syntax', 'Unknown operator')
        }
      }
      if (!Number.isFinite(out)) {
        return err('non_finite', 'Result is not a finite number')
      }
      return ok(out)
    }
    default: {
      const _exhaustive: never = node
      void _exhaustive
      return err('syntax', 'Malformed expression')
    }
  }
}

/**
 * Evaluate one expression string against a scope of already-resolved named
 * values. Pure; never throws.
 *
 *   evaluateExpression('d1*2 + 5', { d1: 10 })  -> { ok: true, value: 25 }
 *   evaluateExpression('1/0', {})               -> { ok: false, error: 'division_by_zero' }
 *   evaluateExpression('nope', {})              -> { ok: false, error: 'unknown_identifier' }
 *
 * An empty / whitespace-only string is the `empty` error (a parameter with no
 * expression is a user mistake the panel flags, not a silent zero).
 */
export function evaluateExpression(expression: string, scope: Scope): EvalResult {
  if (expression.trim().length === 0) {
    return err('empty', 'Expression is empty')
  }
  const tk = tokenize(expression)
  if (!tk.ok) return tk.result
  if (tk.tokens.length === 0) {
    return err('empty', 'Expression is empty')
  }
  const parsed = new Parser(tk.tokens).parse()
  if (!parsed.ok) return parsed.result
  return evalNode(parsed.node, scope)
}

/**
 * The set of identifier names an expression references (for dependency analysis
 * + rename cascades). Best-effort: an unparseable expression still yields every
 * identifier the tokenizer recognised, so the reference-integrity checks (delete
 * blocking, rename cascade) stay conservative even when the RHS has a syntax
 * error elsewhere. Never throws.
 */
export function collectIdentifiers(expression: string): ReadonlySet<string> {
  const out = new Set<string>()
  const tk = tokenize(expression)
  if (!tk.ok) return out
  for (const t of tk.tokens) {
    if (t.type === 'ident') out.add(t.value as string)
  }
  return out
}

// ---------------------------------------------------------------------------
// Multi-parameter resolution (topological, with cycle detection).
// ---------------------------------------------------------------------------

/** One named user parameter: a name + the expression that defines its value. */
export interface NamedExpression {
  readonly name: string
  readonly expression: string
}

/** Per-parameter resolution outcome after {@link resolveParameters}. */
export type ParameterResolution =
  | { readonly ok: true; readonly value: number }
  | {
      readonly ok: false
      readonly error: EvalErrorKind | 'cycle'
      readonly message: string
      /** For a `cycle` error: the reference chain that closes the loop. */
      readonly cycle?: readonly string[]
    }

/** Result of resolving a whole parameter set. */
export interface ResolveResult {
  /** Per-name outcome (every input name appears exactly once). */
  readonly resolutions: ReadonlyMap<string, ParameterResolution>
  /** Just the successfully-resolved name → value pairs (the solver cache). */
  readonly values: Readonly<Record<string, number>>
}

/**
 * Resolve a set of interdependent named expressions to numeric values.
 *
 * Each expression may reference OTHER parameter names in the set; values are
 * resolved in dependency order (a depth-first topological walk). A reference
 * CYCLE (A→B→A, or a self-reference A→A) is reported as a `cycle` error on every
 * node ON the cycle, naming the exact chain (`['a','b','a']`). A reference to a
 * name that is not in the set is `unknown_identifier`. A parameter that depends
 * (transitively) on a failed one fails too, but with its OWN direct error only
 * when it references the failed name directly — otherwise it surfaces the
 * unknown/propagated error honestly.
 *
 * `extraScope` supplies values that are visible to every expression but are NOT
 * part of the resolvable set (e.g. built-in constants in a future revision). It
 * never participates in cycle detection.
 *
 * Pure; never throws. Deterministic: input order fixes the walk order.
 */
export function resolveParameters(
  params: readonly NamedExpression[],
  extraScope: Scope = {}
): ResolveResult {
  const exprByName = new Map<string, string>()
  for (const p of params) exprByName.set(p.name, p.expression)

  const resolutions = new Map<string, ParameterResolution>()
  // DFS colouring: 'visiting' = on the current stack (cycle if re-entered),
  // 'done' = fully resolved (success or failure recorded in `resolutions`).
  const state = new Map<string, 'visiting' | 'done'>()
  // The active DFS path, so a detected cycle can name its chain.
  const stack: string[] = []

  const resolve = (name: string): ParameterResolution => {
    const existing = resolutions.get(name)
    if (existing !== undefined) return existing

    const color = state.get(name)
    if (color === 'visiting') {
      // Re-entered a node already on the stack → cycle. Chain = from the first
      // occurrence of `name` on the stack, through to `name` again.
      const from = stack.indexOf(name)
      const chain = [...stack.slice(from), name]
      return {
        ok: false,
        error: 'cycle',
        message: `Cyclic reference: ${chain.join(' → ')}`,
        cycle: chain
      }
    }

    const expression = exprByName.get(name)
    if (expression === undefined) {
      // Not a resolvable parameter (shouldn't happen for a name from `params`).
      return { ok: false, error: 'unknown_identifier', message: `Unknown parameter "${name}"` }
    }

    state.set(name, 'visiting')
    stack.push(name)

    // Resolve each referenced parameter FIRST so the scope is populated. A cycle
    // discovered here must abort THIS node with the cycle result (do not record a
    // second, misleading error for the same loop).
    const scope: Record<string, number> = { ...extraScope }
    let pendingCycle: ParameterResolution | null = null
    for (const ref of collectIdentifiers(expression)) {
      if (!exprByName.has(ref)) {
        // Either an extraScope constant or a genuinely unknown name — let the
        // evaluator decide (extraScope names are already in `scope`).
        if (Object.prototype.hasOwnProperty.call(extraScope, ref)) {
          scope[ref] = extraScope[ref]!
        }
        continue
      }
      const dep = resolve(ref)
      if (dep.ok) {
        scope[ref] = dep.value
      } else if (dep.error === 'cycle' && dep.cycle && dep.cycle.includes(name)) {
        // This node is ON the reported cycle — propagate the cycle verdict up.
        pendingCycle = dep
        break
      }
      // A dep that failed for a NON-cycle reason (or a cycle not involving this
      // node) leaves `scope[ref]` unset; the evaluator then reports
      // unknown_identifier for `ref` when this expression actually uses it.
    }

    stack.pop()
    state.set(name, 'done')

    const result: ParameterResolution =
      pendingCycle ?? (() => {
        const evaluated = evaluateExpression(expression, scope)
        return evaluated.ok
          ? { ok: true, value: evaluated.value }
          : { ok: false, error: evaluated.error, message: evaluated.message }
      })()

    resolutions.set(name, result)
    return result
  }

  for (const p of params) resolve(p.name)

  const values: Record<string, number> = {}
  for (const [name, res] of resolutions) {
    if (res.ok) values[name] = res.value
  }
  return { resolutions, values }
}
