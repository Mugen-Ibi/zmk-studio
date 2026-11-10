import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import hooks from "eslint-plugin-react-hooks";
import refresh from "eslint-plugin-react-refresh";
import storybook from "eslint-plugin-storybook";

export default [
  {
    ignores: [
      "dist/**",
      "storybook-static/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
      "node_modules/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.cjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": hooks,
      "react-refresh": refresh,
    },
    rules: {
      ...tsPlugin.configs["eslint-recommended"].overrides[0].rules,
      ...tsPlugin.configs.recommended.rules,
      ...hooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "error",
      "react-refresh/only-export-components": [
        "error",
        { allowConstantExport: true },
      ],
    },
  },
  ...storybook.configs["flat/recommended"],
];
