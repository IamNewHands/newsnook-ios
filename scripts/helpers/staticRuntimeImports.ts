import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts'])
const label = (file: string) => relative(root, file).replaceAll('\\', '/')

/** Follow runtime imports and re-exports; type-only edges and dynamic imports stay outside the initial graph. */
export function staticRuntimeImports(entry: string): Map<string, string[]> {
  const paths = new Map<string, string[]>()
  const visit = (file: string, chain: string[]) => {
    const name = label(file)
    if (paths.has(name)) return
    const path = [...chain, name]
    paths.set(name, path)
    if (!sourceExtensions.has(extname(file))) return
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
      if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause
        if (clause?.isTypeOnly) continue
        const bindings = clause?.namedBindings
        if (!clause?.name && bindings && ts.isNamedImports(bindings)
          && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly)) continue
      } else {
        if (statement.isTypeOnly) continue
        const exports = statement.exportClause
        if (exports && ts.isNamedExports(exports)
          && exports.elements.length > 0 && exports.elements.every(item => item.isTypeOnly)) continue
      }
      const specifier = statement.moduleSpecifier.text
      if (!specifier.startsWith('.')) {
        if (!paths.has(specifier)) paths.set(specifier, [...path, specifier])
        continue
      }
      const base = resolve(dirname(file), specifier.split('?')[0])
      const dependency = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts'].map(extension => base + extension),
        ...['index.ts', 'index.tsx', 'index.js'].map(index => resolve(base, index))]
        .find(candidate => existsSync(candidate) && statSync(candidate).isFile())
      assert.ok(dependency, `Cannot resolve ${specifier} from ${name}`)
      visit(dependency, path)
    }
  }
  visit(resolve(root, entry), [])
  return paths
}
