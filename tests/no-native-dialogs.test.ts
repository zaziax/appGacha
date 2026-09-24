import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('uses application dialogs for confirmations and warnings (system file pickers are allowed)', () => {
  const violations: string[] = []
  function scan(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) { scan(file); continue }
      if (!/\.[cm]?[jt]sx?$/.test(file)) continue
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          const expr = node.expression
          const name = ts.isIdentifier(expr) ? expr.text : ts.isPropertyAccessExpression(expr) ? expr.name.text : ''
          const receiver = ts.isPropertyAccessExpression(expr) ? expr.expression.getText(source) : ''
          if (['showMessageBox', 'showMessageBoxSync', 'showErrorBox'].includes(name)
            || ['alert', 'confirm', 'prompt'].includes(name) && (!receiver || ['window', 'globalThis', 'self'].includes(receiver))) {
            violations.push(`${path.relative(path.join(__dirname, '..'), file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  scan(path.join(__dirname, '../src'))
  expect(violations).toEqual([])
})
