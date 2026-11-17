import fs from 'node:fs';
import path from 'node:path';

/**
 * Parses the contents of a .env file into key-value pairs.
 */
export function parseEnv(src: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = src.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const cleanLine = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const equalIndex = cleanLine.indexOf('=');
    if (equalIndex === -1) {
      continue;
    }

    const key = cleanLine.slice(0, equalIndex).trim();
    if (!key) continue;

    let val = cleanLine.slice(equalIndex + 1).trim();

    if (val.startsWith('"')) {
      const lastQuote = val.lastIndexOf('"');
      if (lastQuote > 0) {
        val = val
          .slice(1, lastQuote)
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      } else {
        val = val.slice(1);
      }
    } else if (val.startsWith("'")) {
      const lastQuote = val.lastIndexOf("'");
      if (lastQuote > 0) {
        val = val.slice(1, lastQuote);
      } else {
        val = val.slice(1);
      }
    } else {
      const commentIndex = val.indexOf(' #');
      if (commentIndex !== -1) {
        val = val.slice(0, commentIndex).trim();
      }
    }

    result[key] = val;
  }

  return result;
}

export function findRepoEnvPath(startDir: string = process.cwd()): string | null {
  let curr = path.resolve(startDir);
  while (true) {
    const envCandidate = path.join(curr, '.env');
    if (fs.existsSync(envCandidate)) {
      return envCandidate;
    }
    const isRootCandidate =
      fs.existsSync(path.join(curr, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(curr, '.git'));
    if (isRootCandidate) {
      return path.join(curr, '.env');
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return null;
}

export function loadEnv(filePath?: string): Record<string, string> {
  const targetPath = filePath ?? findRepoEnvPath();
  if (!targetPath || !fs.existsSync(targetPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(targetPath, 'utf8');
    const parsed = parseEnv(content);
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    return parsed;
  } catch {
    return {};
  }
}
