import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? filesUnder(path)
      : path.endsWith('.tsx')
        ? [path]
        : [];
  });
}
/** Guard the cabinet UI contract across pages and shared interactive components. */
export function auditCabinetUi() {
  const issues = [];
  const files = [
    ...filesUnder(join(repositoryRoot, 'apps/web/app')),
    ...filesUnder(join(repositoryRoot, 'apps/web/components')),
  ];
  const routes = [];
  let buttons = 0,
    actions = 0,
    specializedControls = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const root = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const name = relative(repositoryRoot, file).replaceAll('\\', '/');
    if (name.startsWith('apps/web/app/') && name.endsWith('/page.tsx'))
      routes.push(
        '/' +
          name.slice('apps/web/app/'.length).replace(/(?:^|\/)page\.tsx$/, ''),
      );
    const report = (node, message) =>
      issues.push({
        file: name,
        line: root.getLineAndCharacterOfPosition(node.getStart(root)).line + 1,
        message,
      });
    const attribute = (node, key) =>
      node.attributes.properties.find(
        (item) => ts.isJsxAttribute(item) && item.name.getText(root) === key,
      );
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(root);
        const classAttr = attribute(node, 'className');
        const classes = classAttr?.initializer?.getText(root) ?? '';
        if (tag === 'button') {
          buttons++;
          if (classes.includes('ks-button')) {
            actions++;
            if (
              /(?:bg-(?:slate|violet|rose|amber|red)-\d|text-white|rounded(?:-lg|-xl)?(?:\s|"))/.test(
                classes,
              )
            )
              report(
                node,
                'Action button has local cosmetic utilities; use the shared ks-button variants.',
              );
          } else if (classes.includes('ks-control')) specializedControls++;
          else
            report(
              node,
              'Button needs a shared ks-button variant or an explicit specialized ks-control.',
            );
          const parent = node.parent;
          if (
            ts.isJsxElement(parent) &&
            parent.children.every((child) =>
              ts.isJsxText(child)
                ? !child.text.trim()
                : ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child),
            )
          ) {
            const onlyIcons =
              parent.children.some((child) =>
                ts.isJsxSelfClosingElement(child),
              ) &&
              !parent.children.some(
                (child) => ts.isJsxText(child) && child.text.trim(),
              );
            if (
              onlyIcons &&
              !attribute(node, 'aria-label') &&
              !attribute(node, 'aria-labelledby') &&
              !attribute(node, 'title')
            )
              report(node, 'Icon-only button needs an accessible name.');
          }
        }
        if (tag === 'main') {
          for (
            let ancestor = node.parent;
            ancestor;
            ancestor = ancestor.parent
          ) {
            if (
              ts.isJsxElement(ancestor) &&
              ancestor.openingElement.tagName.getText(root) === 'CatalogShell'
            ) {
              report(
                node,
                'CatalogShell already supplies the main landmark; use a section or div.',
              );
              break;
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(root);
  }
  const layout = readFileSync(
    join(repositoryRoot, 'apps/web/app/layout.tsx'),
    'utf8',
  );
  if (
    layout.indexOf("import './cabinet-consistency.css'") <
    layout.indexOf("import './catalog-workspace.css'")
  )
    issues.push({
      file: 'apps/web/app/layout.tsx',
      line: 1,
      message: 'Cabinet consistency styles must follow the legacy page styles.',
    });
  return {
    routes: routes.sort(),
    sourceFiles: files.length,
    buttons,
    actions,
    specializedControls,
    issues,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = auditCabinetUi();
  console.log(JSON.stringify(result, null, 2));
  if (result.issues.length) process.exitCode = 1;
}
