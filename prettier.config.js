/** @type {import('prettier').Config} */
export default {
  trailingComma: 'es5',
  tabWidth: 2,
  semi: true,
  singleQuote: true,
  jsxSingleQuote: true,
  printWidth: 120,
  bracketSpacing: true,
  requirePragma: false,
  bracketSameLine: false,
  arrowParens: 'always',
  endOfLine: 'lf',
  proseWrap: 'always',
  useTabs: false,
  plugins: ['prettier-plugin-tailwindcss'],
};
