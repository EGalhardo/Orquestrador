import ts from 'typescript'

/** Fast syntax-only check for JS/TS files (no type checking). Returns human-readable errors. */
export function syntaxErrors(path: string, content: string): string[] {
  if (!/\.(m?[jt]sx?|cjs)$/.test(path)) return []
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : path.endsWith('.ts') ? ts.ScriptKind.TS : path.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind)
  const diags = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics ?? []
  return diags.slice(0, 10).map((d) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0)
    return `line ${line + 1}:${character + 1} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`
  })
}
