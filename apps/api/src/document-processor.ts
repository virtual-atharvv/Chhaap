import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PageClassification } from '@chhaap/pricing';

export interface DocumentAnalysis {
  pageCount: number;
  perPageClassification: PageClassification[];
  previewFilenames: string[];
}

/**
 * Executes a shell command and returns stdout as string
 */
function execCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command ${cmd} exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Extracts page count using pdfinfo (from poppler-utils)
 */
export async function extractPdfPageCount(filePath: string): Promise<number> {
  try {
    const output = await execCommand('pdfinfo', [filePath]);
    const match = output.match(/Pages:\s+(\d+)/);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
  } catch (err) {
    console.warn('pdfinfo failed, falling back to basic header search:', err);
  }

  // Fallback: simple binary count of /Type /Page
  try {
    const buffer = await fs.readFile(filePath);
    const content = buffer.toString('latin1');
    const matches = content.match(/\/Type\s*\/Page\b/g);
    if (matches && matches.length > 0) {
      return matches.length;
    }
  } catch {
    // Ignore fallback error
  }

  return 1;
}

/**
 * Detects per-page color coverage using Ghostscript inkcov device (implementation.md §6.1)
 */
export async function detectPdfColors(filePath: string, totalPages: number): Promise<PageClassification[]> {
  const classifications: PageClassification[] = [];

  try {
    // gs -o - -sDEVICE=inkcov file.pdf
    const output = await execCommand('gs', ['-o', '-', '-sDEVICE=inkcov', filePath]);
    const lines = output.split('\n');

    let currentPage = 1;
    for (const line of lines) {
      // Lines look like: " 0.01234  0.00000  0.00450  0.12345 CMYK OK"
      if (line.includes('CMYK OK')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const c = parseFloat(parts[0]);
          const m = parseFloat(parts[1]);
          const y = parseFloat(parts[2]);
          // If C, M, or Y has coverage above tiny threshold (0.0005) -> color page
          const isColor = (c > 0.0005 || m > 0.0005 || y > 0.0005);
          classifications.push({
            pageNumber: currentPage,
            isColor
          });
          currentPage++;
        }
      }
    }
  } catch (err) {
    console.warn('Ghostscript inkcov failed, defaulting to all-bw:', err);
  }

  // If inkcov didn't yield enough pages, fill the rest as B&W
  while (classifications.length < totalPages) {
    classifications.push({
      pageNumber: classifications.length + 1,
      isColor: false
    });
  }

  return classifications;
}

/**
 * Generates PNG previews for the first N pages using pdftoppm (implementation.md §11.1 WYSIWYP preview)
 */
export async function generatePdfPreviews(
  filePath: string,
  outDir: string,
  fileId: string,
  maxPages = 5
): Promise<string[]> {
  await fs.mkdir(outDir, { recursive: true });
  const prefix = path.join(outDir, `preview-${fileId}`);

  try {
    // pdftoppm -png -r 96 -f 1 -l maxPages filePath prefix
    await execCommand('pdftoppm', [
      '-png',
      '-r',
      '96',
      '-f',
      '1',
      '-l',
      maxPages.toString(),
      filePath,
      prefix
    ]);

    // Find generated files
    const dirFiles = await fs.readdir(outDir);
    const generated = dirFiles
      .filter((f) => f.startsWith(`preview-${fileId}-`) && f.endsWith('.png'))
      .sort();

    return generated;
  } catch (err) {
    console.warn('pdftoppm preview generation failed:', err);
    return [];
  }
}

/**
 * Full analysis pipeline for an uploaded document
 */
export async function analyzeDocument(
  filePath: string,
  previewDir: string,
  fileId: string
): Promise<DocumentAnalysis> {
  const pageCount = await extractPdfPageCount(filePath);
  const perPageClassification = await detectPdfColors(filePath, pageCount);
  const previewFilenames = await generatePdfPreviews(filePath, previewDir, fileId, 6);

  return {
    pageCount,
    perPageClassification,
    previewFilenames
  };
}
