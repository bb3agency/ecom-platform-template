import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Standard data-fetching pattern (useEffect -> async load -> setState)
      // is used across admin components; disabling to avoid 30+ false positives.
      "react-hooks/set-state-in-effect": "off",
      // Ref sync pattern for callback stability in third-party widget wrappers.
      "react-hooks/refs": "off",
    },
  },
]);

export default eslintConfig;
