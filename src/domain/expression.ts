// Small arithmetic grammar. Expressions are data, never JavaScript.
type Token = { kind: 'number' | 'name' | 'symbol'; value: string }
type Node = { kind: 'number'; value: number } | { kind: 'variable'; name: string } | { kind: 'unary'; op: '-'; child: Node } | { kind: 'binary'; op: string; left: Node; right: Node } | { kind: 'call'; name: string; arg: Node }
const functions: Record<string, (n: number) => number> = { sin: Math.sin, cos: Math.cos, sqrt: Math.sqrt, abs: Math.abs }
const constants: Record<string, number> = { pi: Math.PI, e: Math.E }
const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 }

export function parseExpression(source: string, allowedVariables: readonly string[]): (variables: Record<string, number>) => number {
  if (source.length > 160) throw new Error('Espressione troppo lunga.')
  const tokens: Token[] = []
  const pattern = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z][A-Za-z0-9]*)|([()+*\-/^]))/gy
  let position = 0
  while (position < source.length) {
    pattern.lastIndex = position
    const match = pattern.exec(source)
    if (!match) { if (/^\s+$/.test(source.slice(position))) break; throw new Error(`Simbolo non ammesso alla posizione ${position + 1}.`) }
    tokens.push({ kind: match[1] ? 'number' : match[2] ? 'name' : 'symbol', value: match[1] || match[2] || match[3] })
    position = pattern.lastIndex
    if (tokens.length > 80) throw new Error('Espressione troppo complessa.')
  }
  let cursor = 0
  const peek = () => tokens[cursor]?.value
  const take = () => tokens[cursor++]
  function atom(): Node {
    const token = take()
    if (!token) throw new Error('Espressione incompleta.')
    if (token.value === '-') return { kind: 'unary', op: '-', child: expression(3) }
    if (token.value === '+') return atom()
    if (token.value === '(') { const node = expression(0); if (take()?.value !== ')') throw new Error('Parentesi non chiusa.'); return node }
    if (token.kind === 'number') return { kind: 'number', value: Number(token.value) }
    if (token.kind === 'name') {
      if (peek() === '(') {
        if (!(token.value in functions)) throw new Error(`Funzione ${token.value} non ammessa.`)
        take(); const arg = expression(0); if (take()?.value !== ')') throw new Error('Parentesi funzione non chiusa.')
        return { kind: 'call', name: token.value, arg }
      }
      if (token.value in constants) return { kind: 'number', value: constants[token.value] }
      if (!allowedVariables.includes(token.value)) throw new Error(`Variabile ${token.value} non disponibile.`)
      return { kind: 'variable', name: token.value }
    }
    throw new Error('Espressione non valida.')
  }
  function expression(min: number): Node {
    let left = atom()
    while (peek() && (precedence[peek()!] ?? -1) >= min) {
      const op = take().value; const priority = precedence[op]
      const right = expression(priority + (op === '^' ? 0 : 1))
      left = { kind: 'binary', op, left, right }
    }
    return left
  }
  const tree = expression(0)
  if (cursor !== tokens.length) throw new Error('Testo inatteso dopo l’espressione.')
  function calculate(node: Node, vars: Record<string, number>): number {
    switch (node.kind) {
      case 'number': return node.value
      case 'variable': return vars[node.name]
      case 'unary': return -calculate(node.child, vars)
      case 'call': return functions[node.name](calculate(node.arg, vars))
      case 'binary': {
        const a = calculate(node.left, vars), b = calculate(node.right, vars)
        return node.op === '+' ? a + b : node.op === '-' ? a - b : node.op === '*' ? a * b : node.op === '/' ? a / b : a ** b
      }
    }
  }
  return vars => { const value = calculate(tree, vars); if (!Number.isFinite(value)) throw new Error('Il grafico contiene valori non finiti.'); return value }
}
