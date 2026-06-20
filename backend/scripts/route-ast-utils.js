const ts = require('typescript');

function parseFastifyRoutesFromAst(sourceText) {
  const source = ts.createSourceFile('routes.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const routes = [];

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.getText(source).toLowerCase();
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        const [pathArg] = node.arguments;
        if (pathArg && ts.isStringLiteral(pathArg)) {
          routes.push({ method, path: pathArg.text });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return routes;
}

function parseFastifyRouteConfigsFromAst(sourceText) {
  const source = ts.createSourceFile('routes.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const routes = [];

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.getText(source).toLowerCase();
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        ts.forEachChild(node, visit);
        return;
      }
      const [pathArg, configArg] = node.arguments;
      if (!pathArg || !ts.isStringLiteral(pathArg)) {
        ts.forEachChild(node, visit);
        return;
      }
      let configSource = '';
      if (configArg) {
        configSource = sourceText.slice(configArg.getStart(source), configArg.getEnd()).trim();
      }
      routes.push({
        method,
        path: pathArg.text,
        configSource
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return routes;
}

module.exports = { parseFastifyRoutesFromAst, parseFastifyRouteConfigsFromAst };
