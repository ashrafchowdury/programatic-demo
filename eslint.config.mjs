import { config } from "@remotion/eslint-config-flat";

// Node-side code: recorders, pipeline scripts, flows and shot specs. None of it
// runs inside a Remotion composition, so the composition rules misfire there —
// `@remotion/deterministic-randomness` flags Math.random() in a Playwright flow
// (jitter we WANT), and `react-hooks/rules-of-hooks` flags any plain function
// whose name starts with `use` (useBakedCursor is a boolean, not a hook).
const NODE_SIDE = ["scripts/**", "flows/**", "shots/**", "actions/**", "surfaces/**"];

export default [
  ...config,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Match tsc's noUnusedLocals: `const { a: _a, ...rest } = x` is how this
      // repo drops a field, and tsc already accepts it.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    files: NODE_SIDE,
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
      ...Object.fromEntries(
        config
          .flatMap((c) => Object.keys(c.rules ?? {}))
          .filter((r) => r.startsWith("@remotion/"))
          .map((r) => [r, "off"]),
      ),
    },
  },
];
