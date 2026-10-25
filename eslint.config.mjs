import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default defineConfig([
	globalIgnores([
		"main.js",
		"node_modules/",
		".test-build/",
		"src/picker/emoji-data.ts",
		"src/style/emoji-set-previews.ts",
	]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["*.config.mjs", "scripts/*.mjs"],
				},
			},
		},
	},
	{
		// Obsidian's review rules for manifest.json (description format, forbidden words, …).
		files: ["manifest.json"],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { projectService: false, project: null },
		},
		plugins: { obsidianmd },
		rules: { "obsidianmd/validate-manifest": "error" },
	},
	{
		// minAppVersion is 1.7.2: the settings tab is built in display(), as getSettingDefinitions()
		// needs Obsidian 1.13.
		files: ["src/**"],
		rules: { "obsidianmd/settings-tab/prefer-setting-definitions": "off" },
	},
	{
		// Node tooling (never shipped): fetch and dynamic imports are fine here.
		files: ["scripts/**"],
		rules: {
			"no-restricted-globals": "off",
			"no-unsanitized/method": "off",
		},
	},
	{
		// Tests and tooling build fake Obsidian DOM and run in Node, not in the app.
		files: ["tests/**", "scripts/**", "*.config.*"],
		rules: {
			"obsidianmd/prefer-create-el": "off",
			"obsidianmd/no-nodejs-modules": "off",
			"obsidianmd/no-static-styles-assignment": "off",
			"obsidianmd/hardcoded-config-path": "off",
			"obsidianmd/prefer-instanceof": "off",
			"obsidianmd/no-forbidden-elements": "off",
			"obsidianmd/ui/sentence-case": "off",
			"obsidianmd/no-tfile-tfolder-cast": "off",
			"obsidianmd/no-global-this": "off",
			"obsidianmd/rule-custom-message": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-non-null-assertion": "off",
		},
	},
]);
