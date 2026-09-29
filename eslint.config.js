import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "dist-e2e/**",
      "dist-real/**",
      "dist-manual/**",
      "release/**",
      "**/node_modules/**",
      "**/.tsbuild/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.webextensions },
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "scripts/*.ts",
            "vitest.config.ts",
            "playwright.config.ts",
            "eslint.config.js",
          ],
          defaultProject: "tsconfig.tools.json",
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Async methods that implement promise-returning interfaces (storage, stores) needn't await
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Security (spec §28): no dynamic code, no raw HTML
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "Raw HTML is not allowed (XSS).",
        },
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message: "Use textContent or React.",
        },
      ],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
);
