/**
 * Parses the contents of a .env file into key-value pairs.
 * Supports:
 * - Empty lines and whitespace
 * - Comments starting with #
 * - Optional 'export ' prefix
 * - Double-quoted values (with \n, \r, \t, \" escapes)
 * - Single-quoted values (literal)
 * - Unquoted values (trimmed, strips trailing unquoted comments)
 */
export declare function parseEnv(src: string): Record<string, string>;
/**
 * Finds <repo-root>/.env by traversing upward from a starting directory.
 */
export declare function findRepoEnvPath(startDir?: string): string | null;
/**
 * Loads .env into process.env without overriding existing variables.
 * Returns the loaded key-value map.
 */
export declare function loadEnv(filePath?: string): Record<string, string>;
//# sourceMappingURL=env.d.ts.map