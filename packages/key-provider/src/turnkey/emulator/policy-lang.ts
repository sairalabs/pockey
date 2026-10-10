/**
 * Evaluator for the subset of the Turnkey policy language Pockey emits
 * (`policy.ts`): `&&`, `||`, `!`, comparisons, `in [..]`, `.all(x, ..)`,
 * `.any(x, ..)`, `.contains(..)`, `.count()`, `Timestamp('..')`, string, integer
 * and boolean literals, dotted field access. Emulator only: the real policy engine
 * runs at Turnkey. Unknown syntax throws, so a policy we cannot read is refused.
 *
 * Semantics chosen to match what was observed live: a missing field makes a
 * comparison false (an `eth.tx.*` condition never matches a Solana transaction),
 * and 0x hex strings compare case-insensitively (checksummed or lowercase).
 */

export type Value = string | bigint | boolean | Value[] | { [key: string]: Value } | undefined;

type Token =
  | { kind: 'str'; value: string }
  | { kind: 'num'; value: bigint }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string };

const OPERATORS = ['&&', '||', '==', '!=', '<=', '>=', '<', '>', '!', '(', ')', '[', ']', ',', '.'];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i] ?? '';
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (char === "'") {
      let value = '';
      i++;
      while (i < source.length && source[i] !== "'") {
        if (source[i] === '\\') i++;
        value += source[i] ?? '';
        i++;
      }
      if (source[i] !== "'") throw new Error('Unterminated string in policy');
      i++;
      tokens.push({ kind: 'str', value });
      continue;
    }
    if (/[0-9]/.test(char)) {
      let digits = '';
      while (i < source.length && /[0-9]/.test(source[i] ?? '')) digits += source[i++] ?? '';
      tokens.push({ kind: 'num', value: BigInt(digits) });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let ident = '';
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i] ?? '')) ident += source[i++] ?? '';
      tokens.push({ kind: 'ident', value: ident });
      continue;
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (!op) throw new Error(`Unexpected character "${char}" in policy`);
    tokens.push({ kind: 'op', value: op });
    i += op.length;
  }
  return tokens;
}

type Node =
  | { type: 'literal'; value: Value }
  | { type: 'list'; items: Node[] }
  | { type: 'ident'; name: string }
  | { type: 'member'; object: Node; name: string }
  | { type: 'method'; object: Node; name: string; param?: string; args: Node[] }
  | { type: 'call'; name: string; args: Node[] }
  | { type: 'unary'; op: '!'; operand: Node }
  | { type: 'binary'; op: string; left: Node; right: Node };

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.or();
    if (this.index !== this.tokens.length) throw new Error('Trailing tokens in policy');
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return token?.kind === 'op' && token.value === value;
  }

  private expectOp(value: string): void {
    if (!this.isOp(value)) throw new Error(`Expected "${value}" in policy`);
    this.index++;
  }

  private or(): Node {
    let left = this.and();
    while (this.isOp('||')) {
      this.index++;
      left = { type: 'binary', op: '||', left, right: this.and() };
    }
    return left;
  }

  private and(): Node {
    let left = this.unary();
    while (this.isOp('&&')) {
      this.index++;
      left = { type: 'binary', op: '&&', left, right: this.unary() };
    }
    return left;
  }

  private unary(): Node {
    if (this.isOp('!')) {
      this.index++;
      return { type: 'unary', op: '!', operand: this.unary() };
    }
    return this.comparison();
  }

  private comparison(): Node {
    const left = this.postfix();
    const token = this.peek();
    if (token?.kind === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(token.value)) {
      this.index++;
      return { type: 'binary', op: token.value, left, right: this.postfix() };
    }
    if (token?.kind === 'ident' && token.value === 'in') {
      this.index++;
      return { type: 'binary', op: 'in', left, right: this.postfix() };
    }
    return left;
  }

  private postfix(): Node {
    let node = this.primary();
    while (this.isOp('.')) {
      this.index++;
      const name = this.peek();
      if (name?.kind !== 'ident') throw new Error('Expected a field name in policy');
      this.index++;
      if (this.isOp('(')) {
        this.index++;
        if (name.value === 'all' || name.value === 'any' || name.value === 'filter') {
          const param = this.peek();
          if (param?.kind !== 'ident') throw new Error('Expected a lambda parameter in policy');
          this.index++;
          this.expectOp(',');
          const body = this.or();
          this.expectOp(')');
          node = {
            type: 'method',
            object: node,
            name: name.value,
            param: param.value,
            args: [body],
          };
        } else {
          const args: Node[] = [];
          while (!this.isOp(')')) {
            args.push(this.or());
            if (this.isOp(',')) this.index++;
          }
          this.expectOp(')');
          node = { type: 'method', object: node, name: name.value, args };
        }
      } else {
        node = { type: 'member', object: node, name: name.value };
      }
    }
    return node;
  }

  private primary(): Node {
    const token = this.peek();
    if (!token) throw new Error('Unexpected end of policy');
    this.index++;
    if (token.kind === 'str' || token.kind === 'num')
      return { type: 'literal', value: token.value };
    if (token.kind === 'ident') {
      if (token.value === 'true') return { type: 'literal', value: true };
      if (token.value === 'false') return { type: 'literal', value: false };
      if (this.isOp('(')) {
        this.index++;
        const args: Node[] = [];
        while (!this.isOp(')')) {
          args.push(this.or());
          if (this.isOp(',')) this.index++;
        }
        this.expectOp(')');
        return { type: 'call', name: token.value, args };
      }
      return { type: 'ident', name: token.value };
    }
    if (token.value === '(') {
      const node = this.or();
      this.expectOp(')');
      return node;
    }
    if (token.value === '[') {
      const items: Node[] = [];
      while (!this.isOp(']')) {
        items.push(this.or());
        if (this.isOp(',')) this.index++;
      }
      this.expectOp(']');
      return { type: 'list', items };
    }
    throw new Error(`Unexpected "${token.value}" in policy`);
  }
}

export function parsePolicyExpression(source: string): Node {
  return new Parser(tokenize(source)).parse();
}

export type PolicyNode = Node;

const isHexLike = (value: string) => /^0x[0-9a-fA-F]+$/.test(value);

function equal(a: Value, b: Value): boolean {
  if (a === undefined || b === undefined) return false;
  if (typeof a === 'string' && typeof b === 'string') {
    return isHexLike(a) && isHexLike(b) ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
  if (typeof a === 'bigint' && typeof b === 'bigint') return a === b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b;
  return false;
}

function compare(op: string, a: Value, b: Value): boolean {
  if (op === '==') return equal(a, b);
  if (op === '!=') return a !== undefined && b !== undefined && !equal(a, b);
  if (typeof a !== 'bigint' || typeof b !== 'bigint') return false;
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    default:
      return a >= b;
  }
}

export type Scope = Record<string, Value>;

export function evaluate(node: Node, scope: Scope): Value {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'list':
      return node.items.map((item) => evaluate(item, scope));
    case 'ident':
      return scope[node.name];
    case 'member': {
      const object = evaluate(node.object, scope);
      if (object && typeof object === 'object' && !Array.isArray(object)) return object[node.name];
      return undefined;
    }
    case 'call': {
      if (node.name !== 'Timestamp' || node.args.length !== 1) {
        throw new Error(`Unsupported function ${node.name} in policy`);
      }
      const arg = node.args[0];
      const raw = arg ? evaluate(arg, scope) : undefined;
      if (typeof raw !== 'string' || !/(Z|[+-]00:00)$/.test(raw)) {
        throw new Error('Timestamp expects an RFC 3339 UTC string');
      }
      return BigInt(Date.parse(raw));
    }
    case 'method': {
      const object = evaluate(node.object, scope);
      const list = Array.isArray(object) ? object : undefined;
      switch (node.name) {
        case 'all':
        case 'any': {
          if (!list || !node.param || !node.args[0]) return false;
          const body = node.args[0];
          const test = (item: Value) =>
            evaluate(body, { ...scope, [node.param ?? '']: item }) === true;
          return node.name === 'all' ? list.every(test) : list.some(test);
        }
        case 'contains': {
          const arg = node.args[0];
          const needle = arg ? evaluate(arg, scope) : undefined;
          return list ? list.some((item) => equal(item, needle)) : false;
        }
        case 'count':
          return list ? BigInt(list.length) : undefined;
        default:
          throw new Error(`Unsupported method ${node.name} in policy`);
      }
    }
    case 'unary':
      return evaluate(node.operand, scope) !== true;
    case 'binary': {
      if (node.op === '&&') {
        return evaluate(node.left, scope) === true && evaluate(node.right, scope) === true;
      }
      if (node.op === '||') {
        return evaluate(node.left, scope) === true || evaluate(node.right, scope) === true;
      }
      const left = evaluate(node.left, scope);
      const right = evaluate(node.right, scope);
      if (node.op === 'in') return Array.isArray(right) && right.some((item) => equal(left, item));
      return compare(node.op, left, right);
    }
  }
}
