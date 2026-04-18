/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const repoRoot = process.cwd();
const srcDir = path.join(repoRoot, 'src');
const modulesDir = path.join(srcDir, 'modules');
const appFile = path.join(srcDir, 'app.ts');
const indexFile = path.join(srcDir, 'routes', 'index.ts');
const betterAuthRouteFile = path.join(srcDir, 'routes', 'betterAuth.routes.ts');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, '/');
}

function toWorkspaceRelative(filePath) {
  return normalizeSlashes(path.relative(repoRoot, filePath));
}

function walk(dir, predicate, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, predicate, output);
    } else if (!predicate || predicate(full)) {
      output.push(full);
    }
  }
  return output;
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === "'" || first === '"' || first === '`') && first === last) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function joinUrl(...parts) {
  const compact = parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/');
  const prefixed = compact.startsWith('/') ? compact : `/${compact}`;
  const normalized = prefixed.replace(/\/+/g, '/');
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized;
}

function extractBalanced(text, startIndex, openChar = '(', closeChar = ')') {
  if (text[startIndex] !== openChar) return null;

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];
    const prev = text[i - 1];

    if (escaped) {
      escaped = false;
      continue;
    }

    if ((inSingle || inDouble || inTemplate) && char === '\\') {
      escaped = true;
      continue;
    }

    if (!inDouble && !inTemplate && char === "'" && prev !== '\\') {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inTemplate && char === '"' && prev !== '\\') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && char === '`' && prev !== '\\') {
      inTemplate = !inTemplate;
      continue;
    }

    if (inSingle || inDouble || inTemplate) continue;

    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return { content: text.slice(startIndex + 1, i), endIndex: i };
      }
    }
  }

  return null;
}

function splitTopLevelArgs(input) {
  const args = [];
  let current = '';
  let parens = 0;
  let brackets = 0;
  let braces = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const prev = input[i - 1];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if ((inSingle || inDouble || inTemplate) && char === '\\') {
      current += char;
      escaped = true;
      continue;
    }

    if (!inDouble && !inTemplate && char === "'" && prev !== '\\') {
      inSingle = !inSingle;
      current += char;
      continue;
    }
    if (!inSingle && !inTemplate && char === '"' && prev !== '\\') {
      inDouble = !inDouble;
      current += char;
      continue;
    }
    if (!inSingle && !inDouble && char === '`' && prev !== '\\') {
      inTemplate = !inTemplate;
      current += char;
      continue;
    }

    if (inSingle || inDouble || inTemplate) {
      current += char;
      continue;
    }

    if (char === '(') parens += 1;
    if (char === ')') parens -= 1;
    if (char === '[') brackets += 1;
    if (char === ']') brackets -= 1;
    if (char === '{') braces += 1;
    if (char === '}') braces -= 1;

    if (char === ',' && parens === 0 && brackets === 0 && braces === 0) {
      if (current.trim()) args.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) args.push(current.trim());
  return args;
}

function parseArgName(argument) {
  const value = argument.trim();
  if (!value) return null;

  if (/=>/.test(value) || /^async\s*\(/.test(value) || /^function\b/.test(value)) {
    return '<anonymous>';
  }

  const callMatch = value.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/);
  if (callMatch) return `${callMatch[1]}()`;

  const symbolMatch = value.match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*$/);
  if (symbolMatch) return symbolMatch[1];

  return value.replace(/\s+/g, ' ').slice(0, 80);
}

function shouldSkipRoutePath(routePath) {
  if (!routePath) return true;
  if (routePath.includes('\n')) return true;
  if (routePath.includes('//')) return true;
  if (routePath.includes("'") || routePath.includes('"')) return true;
  return false;
}

function parseRouterInheritedMiddlewares(fileText) {
  const inherited = [];
  const middlewareUseRegex = /router\.use\s*\(([^)]*)\)/g;
  let match;

  while ((match = middlewareUseRegex.exec(fileText)) !== null) {
    const args = splitTopLevelArgs(match[1]);
    if (args.length !== 1) continue;

    const middleware = args[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(middleware)) {
      inherited.push(middleware);
    }
  }

  return Array.from(new Set(inherited));
}

function parseRouterCalls(fileText) {
  const endpoints = [];
  const directMethodRegex = /router\.(get|post|put|patch|delete|options|head|all)\s*\(/g;
  let match;

  while ((match = directMethodRegex.exec(fileText)) !== null) {
    const method = match[1].toUpperCase();
    const openParenIndex = directMethodRegex.lastIndex - 1;
    const balanced = extractBalanced(fileText, openParenIndex, '(', ')');
    if (!balanced) continue;

    const args = splitTopLevelArgs(balanced.content);
    if (!args.length) continue;

    const routePath = stripQuotes(args[0]);
    if (shouldSkipRoutePath(routePath)) {
      directMethodRegex.lastIndex = balanced.endIndex + 1;
      continue;
    }

    const handlerChain = args.slice(1).map(parseArgName).filter(Boolean);
    const handlers = handlerChain.length ? [handlerChain[handlerChain.length - 1]] : [];
    const middlewares = handlerChain.length > 1 ? handlerChain.slice(0, -1) : [];

    endpoints.push({ method, routePath, handlers, middlewares });
    directMethodRegex.lastIndex = balanced.endIndex + 1;
  }

  const routeChainRegex = /router\.route\s*\(/g;
  while ((match = routeChainRegex.exec(fileText)) !== null) {
    const routePathBalanced = extractBalanced(fileText, routeChainRegex.lastIndex - 1, '(', ')');
    if (!routePathBalanced) continue;

    const routeArgs = splitTopLevelArgs(routePathBalanced.content);
    const routePath = routeArgs[0] ? stripQuotes(routeArgs[0]) : '';
    if (shouldSkipRoutePath(routePath)) {
      routeChainRegex.lastIndex = routePathBalanced.endIndex + 1;
      continue;
    }

    let pointer = routePathBalanced.endIndex + 1;
    while (pointer < fileText.length) {
      while (pointer < fileText.length && /\s/.test(fileText[pointer])) pointer += 1;
      if (fileText[pointer] !== '.') break;
      pointer += 1;

      const methodMatch = fileText
        .slice(pointer)
        .match(/^(get|post|put|patch|delete|options|head|all)\s*\(/);
      if (!methodMatch) break;

      const method = methodMatch[1].toUpperCase();
      pointer += methodMatch[1].length;
      while (pointer < fileText.length && /\s/.test(fileText[pointer])) pointer += 1;
      if (fileText[pointer] !== '(') break;

      const methodArgsBalanced = extractBalanced(fileText, pointer, '(', ')');
      if (!methodArgsBalanced) break;

      const methodArgs = splitTopLevelArgs(methodArgsBalanced.content)
        .map(parseArgName)
        .filter(Boolean);
      const handlers = methodArgs.length ? [methodArgs[methodArgs.length - 1]] : [];
      const middlewares = methodArgs.length > 1 ? methodArgs.slice(0, -1) : [];

      endpoints.push({ method, routePath, handlers, middlewares });
      pointer = methodArgsBalanced.endIndex + 1;
    }

    routeChainRegex.lastIndex = pointer;
  }

  return endpoints;
}

function parseRouteImports(indexText, baseDir) {
  const imports = new Map();
  const regex = /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = regex.exec(indexText)) !== null) {
    const symbols = match[1].split(',').map((part) => part.trim()).filter(Boolean);
    const importPath = match[2];
    const tsFile = path.resolve(baseDir, importPath.replace(/\.js$/, '.ts'));

    symbols.forEach((symbol) => imports.set(symbol, tsFile));
  }

  return imports;
}

function parseModuleRouteConfig(indexText) {
  const routeConfig = new Map();
  const regex = /\{\s*path:\s*['"]([^'"]+)['"]\s*,\s*route:\s*([A-Za-z_$][\w$]*)\s*,?\s*\}/g;
  let match;

  while ((match = regex.exec(indexText)) !== null) {
    const routePath = match[1];
    const routeVar = match[2];
    if (!routeConfig.has(routeVar)) routeConfig.set(routeVar, []);
    routeConfig.get(routeVar).push(routePath);
  }

  return routeConfig;
}

function parseAppMounts(appText) {
  const appUseRegex = /app\.use\(\s*['"]([^'"]+)['"]\s*,([\s\S]*?)\);/g;
  const mounts = [];
  let match;

  while ((match = appUseRegex.exec(appText)) !== null) {
    const mountPath = match[1];
    const args = splitTopLevelArgs(match[2]);
    mounts.push({ mountPath, args });
  }

  return mounts;
}

function buildEndpointInventory() {
  const indexText = read(indexFile);
  const appText = read(appFile);

  const imports = parseRouteImports(indexText, path.dirname(indexFile));
  const moduleRoutes = parseModuleRouteConfig(indexText);

  const fileToMounts = new Map();
  for (const [routeVar, routePaths] of moduleRoutes.entries()) {
    const file = imports.get(routeVar);
    if (!file) continue;
    if (!fileToMounts.has(file)) fileToMounts.set(file, []);
    fileToMounts.get(file).push(...routePaths);
  }

  const appMounts = parseAppMounts(appText);
  let apiBase = '/api/v1';
  let authBase = '/api/v1/auth';

  appMounts.forEach(({ mountPath, args }) => {
    if (args.some((arg) => /\brouter\b/.test(arg))) {
      apiBase = mountPath;
    }

    if (args.some((arg) => /\bBetterAuthRoutes\b/.test(arg))) {
      authBase = mountPath;
    }
  });

  const routeFiles = walk(srcDir, (filePath) => filePath.endsWith('routes.ts')).sort();
  const endpoints = [];

  for (const routeFile of routeFiles) {
    const fileText = read(routeFile);
    const inherited = parseRouterInheritedMiddlewares(fileText);
    const calls = parseRouterCalls(fileText);
    if (!calls.length) continue;

    let mountPrefixes = [];
    if (path.resolve(routeFile) === path.resolve(betterAuthRouteFile)) {
      mountPrefixes = [authBase];
    } else if (fileToMounts.has(path.resolve(routeFile))) {
      mountPrefixes = fileToMounts.get(path.resolve(routeFile));
    } else {
      mountPrefixes = [''];
    }

    calls.forEach((endpoint) => {
      mountPrefixes.forEach((prefix) => {
        const fullPath = path.resolve(routeFile) === path.resolve(betterAuthRouteFile)
          ? joinUrl(authBase, endpoint.routePath)
          : joinUrl(apiBase, prefix, endpoint.routePath);

        const middlewares = Array.from(new Set([...inherited, ...endpoint.middlewares]));

        endpoints.push({
          fullPath,
          method: endpoint.method,
          sourceFile: toWorkspaceRelative(routeFile),
          handlers: endpoint.handlers,
          middlewares,
        });
      });
    });
  }

  endpoints.sort((a, b) => {
    const pathComparison = a.fullPath.localeCompare(b.fullPath);
    if (pathComparison !== 0) return pathComparison;
    return a.method.localeCompare(b.method);
  });

  return {
    generatedAt: new Date().toISOString(),
    totalEndpoints: endpoints.length,
    table: endpoints,
  };
}

function isFunctionLike(node) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node);
}

function propNameText(nameNode, sourceFile) {
  if (!nameNode) return null;
  if (ts.isIdentifier(nameNode) || ts.isPrivateIdentifier(nameNode)) return nameNode.text;
  if (ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) return nameNode.text;
  return nameNode.getText(sourceFile);
}

function objectKeys(objectLiteral, sourceFile) {
  const keys = [];
  objectLiteral.properties.forEach((property) => {
    if (
      ts.isPropertyAssignment(property)
      || ts.isShorthandPropertyAssignment(property)
      || ts.isMethodDeclaration(property)
    ) {
      const key = propNameText(property.name, sourceFile);
      if (key) keys.push(key);
    }
  });
  return keys;
}

function getReqSourceFromAccess(node, reqName) {
  if (
    ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === reqName
  ) {
    const source = node.name.text;
    if (source === 'params' || source === 'query' || source === 'body') return source;
  }
  return null;
}

function keyFromReqAccess(node, reqName) {
  if (ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const base = node.expression;
    if (ts.isIdentifier(base.expression) && base.expression.text === reqName) {
      const source = base.name.text;
      if (source === 'params' || source === 'query' || source === 'body') {
        return { source, key: node.name.text };
      }
    }
  }

  if (ts.isElementAccessExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const base = node.expression;
    if (ts.isIdentifier(base.expression) && base.expression.text === reqName) {
      const source = base.name.text;
      if (source === 'params' || source === 'query' || source === 'body') {
        const arg = node.argumentExpression;
        if (arg && ts.isStringLiteral(arg)) {
          return { source, key: arg.text };
        }
      }
    }
  }

  return null;
}

function keyFromAliasAccess(node, aliases, source) {
  if (
    ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && aliases[source].has(node.expression.text)
  ) {
    return node.name.text;
  }

  if (
    ts.isElementAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && aliases[source].has(node.expression.text)
  ) {
    const arg = node.argumentExpression;
    if (arg && ts.isStringLiteral(arg)) return arg.text;
  }

  return null;
}

function isResCallTarget(node, resName) {
  if (!node) return false;
  if (ts.isIdentifier(node)) return node.text === resName;
  if (ts.isPropertyAccessExpression(node)) return isResCallTarget(node.expression, resName);
  if (ts.isCallExpression(node)) return isResCallTarget(node.expression, resName);
  return false;
}

function normalizeStatusCodeToken(token) {
  if (!token) return null;
  const trimmed = token.trim();

  if (/^\d{3}$/.test(trimmed)) {
    return trimmed;
  }

  const map = {
    CREATED: '201',
    OK: '200',
    BAD_REQUEST: '400',
    UNAUTHORIZED: '401',
    FORBIDDEN: '403',
    NOT_FOUND: '404',
    CONFLICT: '409',
    TOO_MANY_REQUESTS: '429',
    INTERNAL_SERVER_ERROR: '500',
  };

  for (const [keyword, code] of Object.entries(map)) {
    if (trimmed.includes(keyword)) return code;
  }

  return null;
}

function analyzeFunctionHandler(fnNode, sourceFile, metadata = {}) {
  const reqName = ts.isIdentifier(fnNode.parameters?.[0]?.name)
    ? fnNode.parameters[0].name.text
    : 'req';
  const resName = ts.isIdentifier(fnNode.parameters?.[1]?.name)
    ? fnNode.parameters[1].name.text
    : 'res';

  const pathParams = new Set();
  const queryParams = new Set();
  const bodyKeys = new Set();
  const statusCodes = new Set();
  const responseShapeKeys = new Set();
  const aliases = { params: new Set(), query: new Set(), body: new Set() };

  function addKey(source, key) {
    if (!key) return;
    if (source === 'params') pathParams.add(key);
    if (source === 'query') queryParams.add(key);
    if (source === 'body') bodyKeys.add(key);
  }

  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        const source = getReqSourceFromAccess(node.initializer, reqName);
        if (source) aliases[source].add(node.name.text);

        const reqKey = keyFromReqAccess(node.initializer, reqName);
        if (reqKey) addKey(reqKey.source, reqKey.key);
      }

      if (ts.isObjectBindingPattern(node.name)) {
        const source = getReqSourceFromAccess(node.initializer, reqName);
        if (source) {
          node.name.elements.forEach((element) => {
            const key = element.propertyName
              ? propNameText(element.propertyName, sourceFile)
              : propNameText(element.name, sourceFile);
            addKey(source, key);
          });
        }
      }
    }

    const direct = keyFromReqAccess(node, reqName);
    if (direct) addKey(direct.source, direct.key);

    ['params', 'query', 'body'].forEach((source) => {
      const key = keyFromAliasAccess(node, aliases, source);
      if (key) addKey(source, key);
    });

    if (ts.isCallExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'status'
        && isResCallTarget(node.expression.expression, resName)
      ) {
        const statusArg = node.arguments[0]?.getText(sourceFile);
        const normalized = normalizeStatusCodeToken(statusArg || '');
        if (normalized) statusCodes.add(normalized);
      }

      if (
        ts.isIdentifier(node.expression)
        && node.expression.text === 'sendResponse'
        && node.arguments.length >= 2
      ) {
        const firstArg = node.arguments[0];
        const secondArg = node.arguments[1];
        if (ts.isIdentifier(firstArg) && firstArg.text === resName && ts.isObjectLiteralExpression(secondArg)) {
          objectKeys(secondArg, sourceFile).forEach((key) => responseShapeKeys.add(key));
          secondArg.properties.forEach((property) => {
            if (ts.isPropertyAssignment(property) && propNameText(property.name, sourceFile) === 'statusCode') {
              const normalized = normalizeStatusCodeToken(property.initializer.getText(sourceFile));
              if (normalized) statusCodes.add(normalized);
            }
          });
        }
      }

      if (
        ts.isPropertyAccessExpression(node.expression)
        && ['json', 'send'].includes(node.expression.name.text)
        && isResCallTarget(node.expression.expression, resName)
      ) {
        const payloadArg = node.arguments[0];
        if (payloadArg && ts.isObjectLiteralExpression(payloadArg)) {
          objectKeys(payloadArg, sourceFile).forEach((key) => responseShapeKeys.add(key));
        }
      }
    }

    if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'ApiError'
      && node.arguments?.[0]
    ) {
      const normalized = normalizeStatusCodeToken(node.arguments[0].getText(sourceFile));
      if (normalized) statusCodes.add(normalized);
    }

    ts.forEachChild(node, visit);
  }

  if (fnNode.body) visit(fnNode.body);

  if (metadata.routePath) {
    const matcher = /:([A-Za-z0-9_]+)/g;
    let match;
    while ((match = matcher.exec(metadata.routePath)) !== null) {
      pathParams.add(match[1]);
    }
  }

  return {
    ...metadata,
    pathParams: Array.from(pathParams).sort(),
    queryParams: Array.from(queryParams).sort(),
    bodyKeys: Array.from(bodyKeys).sort(),
    statusCodes: Array.from(statusCodes),
    responseShapeKeys: Array.from(responseShapeKeys).sort(),
  };
}

function buildControllerContracts() {
  const controllerFiles = walk(modulesDir, (filePath) => /controller\.ts$/i.test(filePath));
  const files = [...controllerFiles, betterAuthRouteFile].filter((filePath) => fs.existsSync(filePath));

  const handlers = [];

  files.forEach((filePath) => {
    const rel = toWorkspaceRelative(filePath);
    const sourceText = read(filePath);
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    function hasReqResParams(fnNode) {
      if (!fnNode.parameters || fnNode.parameters.length < 2) return false;
      return ts.isIdentifier(fnNode.parameters[0].name) && ts.isIdentifier(fnNode.parameters[1].name);
    }

    function visitRouteNodes(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const base = node.expression.expression;
        const method = node.expression.name.text;

        if (
          ts.isIdentifier(base)
          && base.text === 'router'
          && ['get', 'post', 'put', 'patch', 'delete', 'all'].includes(method)
        ) {
          const routePathNode = node.arguments[0];
          const routePath = routePathNode && (ts.isStringLiteral(routePathNode) || ts.isNoSubstitutionTemplateLiteral(routePathNode))
            ? routePathNode.text
            : null;

          let handlerFn = null;
          for (let i = node.arguments.length - 1; i >= 1; i -= 1) {
            if (isFunctionLike(node.arguments[i])) {
              handlerFn = node.arguments[i];
              break;
            }
          }

          if (handlerFn && hasReqResParams(handlerFn)) {
            handlers.push(analyzeFunctionHandler(handlerFn, sourceFile, {
              file: rel,
              handler: `${method.toUpperCase()} ${routePath || '(unknown-path)'}`,
              method: method.toUpperCase(),
              routePath,
            }));
          }
        }
      }

      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'betterAuthCatchAll') {
        const init = node.initializer;
        if (init && isFunctionLike(init) && hasReqResParams(init)) {
          handlers.push(analyzeFunctionHandler(init, sourceFile, {
            file: rel,
            handler: 'betterAuthCatchAll',
            method: null,
            routePath: null,
          }));
        }
      }

      ts.forEachChild(node, visitRouteNodes);
    }

    function visitControllerNodes(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const handlerName = node.name.text;
        const init = node.initializer;
        let fnNode = null;

        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          fnNode = init;
        } else if (init && ts.isCallExpression(init)) {
          init.arguments.forEach((argument) => {
            if (!fnNode && isFunctionLike(argument)) {
              fnNode = argument;
            }
          });
        }

        if (fnNode && hasReqResParams(fnNode)) {
          handlers.push(analyzeFunctionHandler(fnNode, sourceFile, {
            file: rel,
            handler: handlerName,
            method: null,
            routePath: null,
          }));
        }
      }

      if (ts.isFunctionDeclaration(node) && node.name && hasReqResParams(node)) {
        handlers.push(analyzeFunctionHandler(node, sourceFile, {
          file: rel,
          handler: node.name.text,
          method: null,
          routePath: null,
        }));
      }

      ts.forEachChild(node, visitControllerNodes);
    }

    if (rel === 'src/routes/betterAuth.routes.ts') {
      visitRouteNodes(sourceFile);
    } else {
      visitControllerNodes(sourceFile);
    }
  });

  handlers.sort((a, b) => `${a.file}::${a.handler}`.localeCompare(`${b.file}::${b.handler}`));

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      controllersGlob: 'src/modules/**/**controller.ts',
      routeFile: 'src/routes/betterAuth.routes.ts',
    },
    totalHandlers: handlers.length,
    handlers,
  };
}

function pathToOpenApi(pathValue) {
  return pathValue.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function toTitleCase(input) {
  return input
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function guessPrimitiveType(key) {
  const lower = key.toLowerCase();
  if (['page', 'limit', 'price', 'amount', 'duration', 'watchtime', 'lastwatchedposition', 'maxcapacity'].includes(lower)) {
    return 'number';
  }
  if (['approved', 'rememberme', 'revokeothersessions', 'enabled', 'ispublished'].includes(lower)) {
    return 'boolean';
  }
  if (lower.endsWith('ids') || lower.endsWith('orders') || lower.includes('tags') || lower.includes('interests')) {
    return 'array';
  }
  return 'string';
}

function exampleValueForKey(key) {
  const lower = key.toLowerCase();
  if (lower.includes('email')) return 'user@example.com';
  if (lower.includes('password')) return 'P@ssw0rd!';
  if (lower.includes('url')) return 'https://example.com/resource';
  if (lower.includes('date')) return '2026-04-16T10:00:00.000Z';
  if (lower.includes('status')) return 'active';
  if (lower.includes('id')) return '66f1ad6b2f4d7e0d4f9d1234';

  const primitive = guessPrimitiveType(key);
  if (primitive === 'number') return 1;
  if (primitive === 'boolean') return true;
  if (primitive === 'array') return [];
  return 'string';
}

function createBodySchemaFromKeys(keys) {
  if (!keys || !keys.length) return null;

  const properties = {};
  const required = [];
  const example = {};

  keys.forEach((key) => {
    const primitive = guessPrimitiveType(key);
    if (primitive === 'array') {
      properties[key] = { type: 'array', items: { type: 'string' } };
    } else {
      properties[key] = { type: primitive };
    }

    required.push(key);
    example[key] = exampleValueForKey(key);
  });

  return {
    schema: {
      type: 'object',
      properties,
      required,
      additionalProperties: true,
    },
    example,
  };
}

function normalizeSuccessCodes(codes, method) {
  const normalized = Array.from(new Set((codes || []).map(normalizeStatusCodeToken).filter(Boolean)));
  const onlySuccess = normalized.filter((code) => code.startsWith('2'));

  if (onlySuccess.length) return onlySuccess;

  if (method === 'POST') return ['201'];
  if (method === 'DELETE') return ['200'];
  return ['200'];
}

function getTagFromPath(fullPath) {
  const relative = fullPath.replace(/^\/api\/v1\/?/, '');
  const firstSegment = relative.split('/')[0] || 'misc';
  if (firstSegment === '') return 'misc';
  if (firstSegment === 'admin') {
    if (relative.includes('/modules/')) return 'admin-modules';
    if (relative.includes('/lessons/')) return 'admin-lessons';
  }
  return firstSegment;
}

function inferDataSchemaRef(fullPath) {
  if (fullPath.includes('/admin/users')) return '#/components/schemas/User';
  if (fullPath.includes('/courses')) return '#/components/schemas/Course';
  if (fullPath.includes('/batches')) return '#/components/schemas/Batch';
  if (fullPath.includes('/enrollments') || fullPath.includes('/course-enrollment')) return '#/components/schemas/Enrollment';
  if (fullPath.includes('/certificates')) return '#/components/schemas/Certificate';
  if (fullPath.includes('/payments')) return '#/components/schemas/Payment';
  if (fullPath.includes('/profile')) return '#/components/schemas/Profile';
  if (fullPath.includes('/recordings')) return '#/components/schemas/Recording';
  if (fullPath.includes('/admin/modules') || fullPath.includes('/content') && fullPath.includes('/modules')) return '#/components/schemas/Module';
  if (fullPath.includes('/admin/lessons') || fullPath.includes('/content') && fullPath.includes('/lessons')) return '#/components/schemas/Lesson';
  if (fullPath.includes('/upload')) return '#/components/schemas/Document';
  if (fullPath.includes('/auth')) return '#/components/schemas/AuthResponse';
  return null;
}

function buildOperationId(method, fullPath) {
  const normalized = fullPath
    .replace(/^\/api\/v1\//, '')
    .replace(/[{}:]/g, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9]/g, ''))
    .map((segment, index) => (index === 0 ? segment.toLowerCase() : segment.charAt(0).toUpperCase() + segment.slice(1)))
    .join('');
  return `${method.toLowerCase()}${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function inferRoles(middlewares) {
  const roles = [];
  if (middlewares.includes('requireSuperAdmin')) roles.push('superadmin');
  if (middlewares.includes('requireAdmin')) roles.push('admin', 'superadmin');
  if (middlewares.includes('requireInstructor')) roles.push('instructor', 'admin', 'superadmin');
  if (middlewares.includes('requireEmployee')) roles.push('employee', 'admin', 'superadmin');
  return Array.from(new Set(roles));
}

function inferProtection(fullPath, middlewares) {
  const hasAuthMiddleware = middlewares.some((mw) =>
    ['requireAuth', 'requireAdmin', 'requireSuperAdmin', 'requireInstructor', 'requireEmployee', 'checkBatchEnrollment'].includes(mw));
  if (hasAuthMiddleware) return true;

  const protectedAuthEndpoints = [
    '/api/v1/auth/me',
    '/api/v1/auth/server/list-sessions',
    '/api/v1/auth/server/change-password',
    '/api/v1/auth/server/revoke-session',
    '/api/v1/auth/server/sign-out',
    '/api/v1/auth/server/update-user',
  ];

  return protectedAuthEndpoints.includes(fullPath);
}

function buildSchemaComponents() {
  return {
    Meta: {
      type: 'object',
      properties: {
        page: { type: 'number', example: 1 },
        limit: { type: 'number', example: 10 },
        total: { type: 'number', example: 42 },
        totalPages: { type: 'number', example: 5 },
      },
    },
    ErrorMessage: {
      type: 'object',
      properties: {
        path: { type: 'string', example: 'email' },
        message: { type: 'string', example: 'email is required' },
      },
    },
    ErrorResponse: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Validation failed' },
        errorMessages: {
          type: 'array',
          items: { $ref: '#/components/schemas/ErrorMessage' },
        },
      },
      required: ['success', 'message'],
    },
    StandardSuccess: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Request successful' },
        meta: { $ref: '#/components/schemas/Meta' },
        data: { type: 'object', additionalProperties: true },
      },
      required: ['success', 'statusCode', 'message'],
    },
    User: {
      type: 'object',
      properties: {
        _id: { type: 'string', example: '66f1ad6b2f4d7e0d4f9d1234' },
        name: { type: 'string', example: 'John Doe' },
        email: { type: 'string', format: 'email', example: 'john@example.com' },
        role: {
          type: 'string',
          enum: ['superadmin', 'admin', 'instructor', 'learner', 'employee'],
          example: 'learner',
        },
        status: {
          type: 'string',
          enum: ['active', 'suspended', 'deleted'],
          example: 'active',
        },
        emailVerified: { type: 'boolean', example: true },
        image: { type: 'string', nullable: true },
      },
      required: ['_id', 'name', 'email', 'role', 'status', 'emailVerified'],
    },
    Course: {
      type: 'object',
      properties: {
        _id: { type: 'string' },
        title: { type: 'string' },
        slug: { type: 'string' },
        shortDescription: { type: 'string' },
        fullDescription: { type: 'string' },
        level: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
        category: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'published', 'archived'] },
        learningOutcomes: { type: 'array', items: { type: 'string' } },
        prerequisites: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
        thumbnailImage: { type: 'string' },
        coverImage: { type: 'string', nullable: true },
      },
      required: ['_id', 'title', 'slug', 'fullDescription', 'level', 'status'],
    },
    Document: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        type: { type: 'string', enum: ['file', 'link', 'document', 'certificate'] },
        url: { type: 'string', format: 'uri' },
        publicId: { type: 'string' },
      },
      required: ['id', 'title', 'type'],
    },
    AuthResponse: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Authenticated successfully' },
        data: {
          type: 'object',
          properties: {
            token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            user: { $ref: '#/components/schemas/User' },
          },
        },
      },
      required: ['success', 'message'],
    },
    Batch: {
      type: 'object',
      properties: {
        _id: { type: 'string' },
        courseId: { type: 'string' },
        title: { type: 'string' },
        batchNumber: { type: 'number' },
        status: { type: 'string', enum: ['draft', 'upcoming', 'running', 'completed'] },
        price: { type: 'number' },
        manualPaymentPrice: { type: 'number', nullable: true },
        currentEnrollment: { type: 'number' },
        startDate: { type: 'string', format: 'date-time' },
        endDate: { type: 'string', format: 'date-time' },
      },
      required: ['_id', 'courseId', 'title', 'status', 'price'],
    },
    Enrollment: {
      type: 'object',
      properties: {
        _id: { type: 'string' },
        enrollmentId: { type: 'string' },
        userId: { type: 'string' },
        batchId: { type: 'string' },
        paymentId: { type: 'string', nullable: true },
        status: {
          type: 'string',
          enum: ['pending', 'payment-pending', 'active', 'completed', 'suspended', 'refunded', 'payment-failed'],
        },
        certificateIssued: { type: 'boolean' },
        enrolledAt: { type: 'string', format: 'date-time' },
      },
      required: ['_id', 'userId', 'batchId', 'status'],
    },
    Payment: {
      type: 'object',
      properties: {
        _id: { type: 'string' },
        transactionId: { type: 'string' },
        userId: { type: 'string' },
        batchId: { type: 'string' },
        amount: { type: 'number' },
        currency: { type: 'string', example: 'BDT' },
        status: { type: 'string', enum: ['pending', 'success', 'failed', 'review', 'risk', 'cancel'] },
        method: { type: 'string', enum: ['SSLCommerz', 'PhonePay'] },
      },
      required: ['_id', 'transactionId', 'userId', 'batchId', 'amount', 'status', 'method'],
    },
    Certificate: {
      type: 'object',
      properties: {
        _id: { type: 'string' },
        certificateId: { type: 'string' },
        enrollmentId: { type: 'string' },
        userId: { type: 'string' },
        batchId: { type: 'string' },
        courseId: { type: 'string' },
        certificateUrl: { type: 'string', format: 'uri' },
        verificationUrl: { type: 'string', format: 'uri' },
        status: { type: 'string', enum: ['pending', 'active', 'revoked'] },
      },
      required: ['_id', 'certificateId', 'enrollmentId', 'userId', 'courseId', 'status'],
    },
    Profile: {
      type: 'object',
      properties: {
        _id: { type: 'string' },
        user: { type: 'string' },
        phone: { type: 'string', nullable: true },
        bio: { type: 'string', nullable: true },
        address: { type: 'string', nullable: true },
        currentJob: { type: 'string', nullable: true },
        industry: { type: 'string', nullable: true },
        areasOfInterest: { type: 'array', items: { type: 'string' } },
      },
      required: ['_id', 'user'],
    },
    Module: {
      type: 'object',
      properties: {
        _id: { type: 'string' },
        courseId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        orderIndex: { type: 'number' },
        status: { type: 'string', enum: ['draft', 'published'] },
      },
      required: ['_id', 'courseId', 'title', 'orderIndex'],
    },
    Lesson: {
      type: 'object',
      properties: {
        _id: { type: 'string' },
        moduleId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string', nullable: true },
        type: { type: 'string', enum: ['video', 'reading', 'quiz', 'project'] },
        orderIndex: { type: 'number' },
        videoUrl: { type: 'string', nullable: true },
      },
      required: ['_id', 'moduleId', 'title', 'type', 'orderIndex'],
    },
    Recording: {
      type: 'object',
      properties: {
        _id: { type: 'string' },
        courseId: { type: 'string' },
        batchId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string', nullable: true },
        videoSource: { type: 'string', enum: ['youtube', 'googledrive'] },
        videoId: { type: 'string' },
        isPublished: { type: 'boolean' },
      },
      required: ['_id', 'courseId', 'batchId', 'title', 'videoSource', 'videoId'],
    },
  };
}

function createResponseContent(successCode, dataSchemaRef) {
  const successTemplate = {
    success: true,
    statusCode: Number(successCode),
    message: 'Request successful',
    data: {},
  };

  return {
    description: 'Successful response',
    content: {
      'application/json': {
        schema: dataSchemaRef
          ? {
              allOf: [
                { $ref: '#/components/schemas/StandardSuccess' },
                {
                  type: 'object',
                  properties: {
                    data: {
                      oneOf: [
                        { $ref: dataSchemaRef },
                        {
                          type: 'array',
                          items: { $ref: dataSchemaRef },
                        },
                      ],
                    },
                  },
                },
              ],
            }
          : { $ref: '#/components/schemas/StandardSuccess' },
        example: successTemplate,
      },
    },
  };
}

function buildOpenApiSpec(inventory, contracts) {
  const contractIndex = new Map();
  contracts.handlers.forEach((handler) => {
    const key = `${handler.file}::${handler.handler}`;
    contractIndex.set(key, handler);
  });

  const openApi = {
    openapi: '3.0.3',
    info: {
      title: 'Misun Academy Server API',
      version: '1.0.0',
      description: 'Comprehensive OpenAPI documentation generated from Express routes, controller contracts, and middleware analysis for the Misun Academy backend.',
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Development server',
      },
      {
        url: 'https://api.misunacademy.com',
        description: 'Production server',
      },
    ],
    tags: [],
    paths: {},
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: buildSchemaComponents(),
    },
  };

  const tagSet = new Set();

  inventory.table.forEach((endpoint) => {
    const openApiPath = pathToOpenApi(endpoint.fullPath);
    const operationMethod = endpoint.method.toLowerCase();
    if (!openApi.paths[openApiPath]) openApi.paths[openApiPath] = {};

    const tag = getTagFromPath(endpoint.fullPath);
    tagSet.add(tag);

    const handlerNameRaw = endpoint.handlers?.[0] || '';
    const handlerName = handlerNameRaw.includes('.')
      ? handlerNameRaw.split('.').pop()
      : handlerNameRaw;

    let contract = null;
    const moduleName = endpoint.sourceFile.split('/')[2];

    if (endpoint.sourceFile === 'src/routes/betterAuth.routes.ts') {
      const betterAuthContract = contracts.handlers.find((item) =>
        item.file === 'src/routes/betterAuth.routes.ts'
        && item.method === endpoint.method
        && item.routePath
        && joinUrl('/api/v1/auth', item.routePath) === endpoint.fullPath);
      contract = betterAuthContract || null;
    } else {
      contract = contracts.handlers.find((item) =>
        item.handler === handlerName
        && item.file.includes(`/modules/${moduleName}/`));
    }

    const pathParamNames = Array.from(new Set([
      ...((endpoint.fullPath.match(/:([A-Za-z0-9_]+)/g) || []).map((token) => token.slice(1))),
      ...(contract?.pathParams || []),
    ]));

    const parameters = [];
    pathParamNames.forEach((paramName) => {
      parameters.push({
        name: paramName,
        in: 'path',
        required: true,
        schema: { type: 'string' },
        example: '66f1ad6b2f4d7e0d4f9d1234',
      });
    });

    (contract?.queryParams || []).forEach((queryParam) => {
      parameters.push({
        name: queryParam,
        in: 'query',
        required: false,
        schema: { type: guessPrimitiveType(queryParam) === 'array' ? 'string' : guessPrimitiveType(queryParam) },
        example: exampleValueForKey(queryParam),
      });
    });

    const requiresAuth = inferProtection(endpoint.fullPath, endpoint.middlewares || []);
    const requiredRoles = inferRoles(endpoint.middlewares || []);

    let requestBody = null;
    const requestKeys = contract?.bodyKeys || [];
    const bodyPayload = createBodySchemaFromKeys(requestKeys);

    if (['post', 'put', 'patch'].includes(operationMethod)) {
      if (endpoint.fullPath.includes('/upload/')) {
        const fileField = endpoint.fullPath.includes('/multiple') ? 'images' : 'image';
        requestBody = {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  [fileField]: endpoint.fullPath.includes('/multiple')
                    ? { type: 'array', items: { type: 'string', format: 'binary' } }
                    : { type: 'string', format: 'binary' },
                },
                required: [fileField],
              },
            },
          },
        };
      } else if (bodyPayload) {
        requestBody = {
          required: true,
          content: {
            'application/json': {
              schema: bodyPayload.schema,
              example: bodyPayload.example,
            },
          },
        };
      }
    }

    const dataSchemaRef = inferDataSchemaRef(endpoint.fullPath);
    const successCodes = normalizeSuccessCodes(contract?.statusCodes || [], endpoint.method);
    const responses = {};

    successCodes.forEach((statusCode) => {
      responses[statusCode] = createResponseContent(statusCode, dataSchemaRef);
    });

    responses['400'] = {
      description: 'Bad Request',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
          example: {
            success: false,
            message: 'Validation failed',
            errorMessages: [{ path: 'field', message: 'Invalid value' }],
          },
        },
      },
    };

    responses['401'] = {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
          example: {
            success: false,
            message: 'Authentication required',
            errorMessages: [{ path: 'auth', message: 'Invalid or expired session' }],
          },
        },
      },
    };

    responses['403'] = {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
          example: {
            success: false,
            message: 'You do not have permission to access this resource',
            errorMessages: [{ path: 'role', message: 'Insufficient permissions' }],
          },
        },
      },
    };

    responses['500'] = {
      description: 'Internal Server Error',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
          example: {
            success: false,
            message: 'Something went wrong',
            errorMessages: [],
          },
        },
      },
    };

    const summaryPath = endpoint.fullPath.replace('/api/v1/', '');
    const operation = {
      tags: [tag],
      operationId: buildOperationId(endpoint.method, openApiPath),
      summary: `${endpoint.method} ${summaryPath}`,
      description: `Auto-generated from ${endpoint.sourceFile}. Handler: ${handlerNameRaw || 'unknown'}.`,
      parameters,
      responses,
    };

    if (requestBody) {
      operation.requestBody = requestBody;
    }

    if (requiresAuth) {
      operation.security = [{ bearerAuth: [] }];
    }

    if (requiredRoles.length) {
      operation['x-required-roles'] = requiredRoles;
    }

    openApi.paths[openApiPath][operationMethod] = operation;
  });

  openApi.paths['/'] = {
    get: {
      tags: ['system'],
      operationId: 'getRootHealth',
      summary: 'API health route',
      description: 'Default health route defined in the Express app root.',
      responses: {
        '200': {
          description: 'Service is running',
          content: {
            'text/plain': {
              schema: { type: 'string', example: 'API is running' },
            },
          },
        },
      },
    },
  };
  tagSet.add('system');

  openApi.tags = Array.from(tagSet)
    .sort()
    .map((name) => ({
      name,
      description: `${toTitleCase(name)} endpoints`,
    }));

  return openApi;
}

function buildIssueReport(inventory) {
  const issues = [];

  const groupedByPathMethod = new Map();
  inventory.table.forEach((endpoint) => {
    const key = `${endpoint.method} ${endpoint.fullPath}`;
    if (!groupedByPathMethod.has(key)) groupedByPathMethod.set(key, []);
    groupedByPathMethod.get(key).push(endpoint.sourceFile);
  });

  for (const [key, files] of groupedByPathMethod.entries()) {
    if (files.length > 1) {
      issues.push({
        severity: 'medium',
        type: 'Duplicate endpoint declaration',
        endpoint: key,
        detail: `Declared in multiple route files: ${files.join(', ')}`,
      });
    }
  }

  inventory.table.forEach((endpoint) => {
    if (endpoint.middlewares.includes('requireAdmin') && !endpoint.middlewares.includes('requireAuth')) {
      issues.push({
        severity: 'high',
        type: 'RBAC middleware order risk',
        endpoint: `${endpoint.method} ${endpoint.fullPath}`,
        detail: 'Role middleware found without explicit requireAuth in handler chain.',
      });
    }

    if (['POST', 'PUT', 'PATCH'].includes(endpoint.method) && endpoint.middlewares.every((mw) => mw !== 'validateRequest()')) {
      if (!endpoint.fullPath.includes('/auth/server/') && !endpoint.fullPath.includes('/upload/')) {
        issues.push({
          severity: 'medium',
          type: 'Missing request validation',
          endpoint: `${endpoint.method} ${endpoint.fullPath}`,
          detail: 'Mutation endpoint does not include validateRequest middleware.',
        });
      }
    }

    if (endpoint.fullPath.includes('/status') && endpoint.method === 'GET') {
      issues.push({
        severity: 'low',
        type: 'Mixed status endpoint semantics',
        endpoint: `${endpoint.method} ${endpoint.fullPath}`,
        detail: 'Status endpoint supports GET and POST; consider one canonical verb.',
      });
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    totalFindings: issues.length,
    findings: issues,
  };
}

function run() {
  const inventory = buildEndpointInventory();
  const contracts = buildControllerContracts();
  const openApi = buildOpenApiSpec(inventory, contracts);

  writeJson(path.join(repoRoot, 'openapi.json'), openApi);

  console.log(`Generated openapi.json (${Object.keys(openApi.paths).length} paths)`);
}

run();
