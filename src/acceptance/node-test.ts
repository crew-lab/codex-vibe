import ts from 'typescript';

export interface NodeTestInspection { passed: boolean; reason: string; cases: number }
type Binding = 'test' | 'test_namespace' | 'strict_assert' | 'strict_namespace' | 'assert' | 'strict_method';
const strictMethods = new Set(['strictEqual', 'notStrictEqual', 'deepStrictEqual', 'notDeepStrictEqual']);
const strictApi = new Set(['ok', 'equal', 'notEqual', 'deepEqual', 'notDeepEqual', ...strictMethods, 'throws', 'doesNotThrow', 'rejects', 'doesNotReject', 'ifError', 'match', 'doesNotMatch']);

export function inspectNodeTests(text: string, minimum: number): NodeTestInspection {
  const fileName = '/node-test-input.mjs';
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const host: ts.CompilerHost = {
    getSourceFile: (name) => name === fileName ? source : undefined,
    getDefaultLibFileName: () => '', writeFile: () => undefined,
    getCurrentDirectory: () => '/', getDirectories: () => [], fileExists: (name) => name === fileName,
    readFile: (name) => name === fileName ? text : undefined,
    getCanonicalFileName: (name) => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n'
  };
  const program = ts.createProgram([fileName], { allowJs: true, noResolve: true, noLib: true }, host);
  if (program.getSyntacticDiagnostics(source).length) return { passed: false, reason: 'node-test-parse-error', cases: 0 };
  const checker = program.getTypeChecker();
  const bindings = new Map<ts.Symbol, Binding>();
  const bind = (node: ts.Identifier, kind: Binding): void => {
    const symbol = checker.getSymbolAtLocation(node);
    if (symbol?.declarations?.length === 1) bindings.set(symbol, kind);
  };
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause || statement.importClause.isTypeOnly) continue;
    const module = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!['node:test', 'node:assert', 'node:assert/strict'].includes(module)) continue;
    if (clause.name) bind(clause.name, module === 'node:test' ? 'test' : module === 'node:assert/strict' ? 'strict_assert' : 'assert');
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) bind(named.name, module === 'node:test' ? 'test_namespace' : module === 'node:assert/strict' ? 'strict_namespace' : 'assert');
    if (named && ts.isNamedImports(named)) for (const entry of named.elements) {
      if (entry.isTypeOnly) continue;
      const imported = (entry.propertyName ?? entry.name).text;
      if (module === 'node:test' && ['test', 'it', 'default'].includes(imported)) bind(entry.name, 'test');
      else if (module !== 'node:test' && imported === 'strict') bind(entry.name, 'strict_assert');
      else if (module !== 'node:test' && (strictMethods.has(imported) || (module === 'node:assert/strict' && strictApi.has(imported)))) bind(entry.name, 'strict_method');
      else if (module !== 'node:test' && imported === 'default') bind(entry.name, module === 'node:assert/strict' ? 'strict_assert' : 'assert');
    }
  }
  const binding = (node: ts.Expression): Binding | undefined => ts.isIdentifier(node) ? bindings.get(checker.getSymbolAtLocation(node)!) : undefined;
  const isTest = (node: ts.Expression): boolean => binding(node) === 'test' || (ts.isPropertyAccessExpression(node) && binding(node.expression) === 'test_namespace' && ['test', 'it', 'default'].includes(node.name.text));
  const isAssertion = (node: ts.Expression): boolean => {
    const direct = binding(node);
    if (direct === 'strict_assert' || direct === 'strict_method') return true;
    if (!ts.isPropertyAccessExpression(node)) return false;
    const parent = binding(node.expression);
    if (parent === 'strict_assert' || parent === 'strict_namespace') return strictApi.has(node.name.text);
    if (parent === 'assert') return strictMethods.has(node.name.text) || node.name.text === 'strict';
    return ts.isPropertyAccessExpression(node.expression) && binding(node.expression.expression) === 'assert' && node.expression.name.text === 'strict' && strictApi.has(node.name.text);
  };
  const containsAssertion = (body: ts.ConciseBody): boolean => {
    let found = false;
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
      if (ts.isCallExpression(node) && isAssertion(node.expression)) found = true;
      if (!found) ts.forEachChild(node, visit);
    };
    visit(body);
    return found;
  };
  let cases = 0;
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const expression = ts.isAwaitExpression(statement.expression) ? statement.expression.expression : statement.expression;
    if (!ts.isCallExpression(expression) || !isTest(expression.expression)) continue;
    if (expression.arguments.length !== 2) return { passed: false, reason: 'node-test-unsupported-case', cases };
    const [name, callback] = expression.arguments;
    if (!name || !(ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) || !name.text.trim() || !callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) || callback.asteriskToken || !containsAssertion(callback.body)) return { passed: false, reason: 'node-test-case-needs-name-and-strict-assertion', cases };
    cases++;
  }
  return { passed: cases >= minimum, reason: cases >= minimum ? 'node-test-named-strict-cases' : 'node-test-insufficient-cases', cases };
}
