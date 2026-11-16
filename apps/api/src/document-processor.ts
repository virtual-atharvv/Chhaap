import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DocumentAnalysis, PageClassification } from '@chhaap/shared';

/**
 * Concurrency limiter: protects the CPU from simultaneous Ghostscript /
 * LibreOffice runs. External binaries are expensive and can OOM a shop VPS.
 */
class ConcurrencyLimiter {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrency = 3) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const processorLimiter = new ConcurrencyLimiter(3);

/**
 * Executes an external binary using execFile with argument arrays (never a
 * shell string), a timeout and a bounded output buffer.
 */
export function safeExec(file: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Command ${file} failed: ${error.message} ${String(stderr).slice(0, 2000)}`));
        } else {
          resolve(String(stdout));
        }
      }
    );
  });
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await safeExec('which', [command], 5000);
    return true;
  } catch {
    return false;
  }
}

export async function extractPdfPageCount(filePath: string): Promise<number> {
  return processorLimiter.run(async () => {
    try {
      const output = await safeExec('pdfinfo', [filePath], 20_000);
      const match = output.match(/Pages:\s+(\d+)/);
      if (match && match[1]) return parseInt(match[1], 10);
    } catch (err) {
      console.warn('[document] pdfinfo failed, using fallback:', (err as Error).message);
    }

    // Fallback: binary page-object count. Never trust a client-supplied count.
    try {
      const buffer = await fs.readFile(filePath);
      const content = buffer.toString('latin1');
      const matches = content.match(/\/Type\s*\/Page\b/g);
      if (matches && matches.length > 0) return matches.length;
    } catch {
      // ignore
    }
    return 0;
  });
}

function parseInkcov(output: string): PageClassification[] {
  const classifications: PageClassification[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    if (!line.includes('CMYK OK')) continue;
    const numbers = line.trim().split(/\s+/);
    if (numbers.length < 4) continue;
    const c = parseFloat(numbers[0]);
    const m = parseFloat(numbers[1]);
    const y = parseFloat(numbers[2]);
    if (Number.isNaN(c) || Number.isNaN(m) || Number.isNaN(y)) continue;
    classifications.push({
      pageNumber: classifications.length + 1,
      isColor: c > 0.0005 || m > 0.0005 || y > 0.0005
    });
  }

  return classifications;
}

export async function detectPdfColors(
  filePath: string,
  totalPages: number
): Promise<PageClassification[]> {
  return processorLimiter.run(async () => {
    let classifications: PageClassification[] = [];
    try {
      const output = await safeExec('gs', ['-q', '-o', '-', '-sDEVICE=inkcov', filePath], 45_000);
      classifications = parseInkcov(output);
    } catch (err) {
      console.warn('[document] Ghostscript inkcov failed; defaulting to B&W:', (err as Error).message);
    }

    while (classifications.length < totalPages) {
      classifications.push({ pageNumber: classifications.length + 1, isColor: false });
    }
    return classifications.slice(0, totalPages);
  });
}

export async function generatePdfPreviews(
  filePath: string,
  outDir: string,
  fileId: string,
  maxPages = 6
): Promise<string[]> {
  return processorLimiter.run(async () => {
    await fs.mkdir(outDir, { recursive: true, mode: 0o700 });
    const safeId = fileId.replace(/[^a-zA-Z0-9-]/g, '_');
    const prefix = path.join(outDir, `preview-${safeId}`);

    try {
      await safeExec('pdftoppm', [
        '-png',
        '-r',
        '96',
        '-f',
        '1',
        '-l',
        String(maxPages),
        filePath,
        prefix
      ], 45_000);

      const dirFiles = await fs.readdir(outDir);
      return dirFiles
        .filter((f) => f.startsWith(`preview-${safeId}-`) && f.endsWith('.png'))
        .sort();
    } catch (err) {
      console.warn('[document] pdftoppm preview generation failed:', (err as Error).message);
      return [];
    }
  });
}

/**
 * Converts any accepted upload to a print-ready PDF. The agent only ever
 * receives PDFs, which eliminates Windows-driver/font inconsistencies.
 */
export async function convertToPdf(
  inputPath: string,
  originalName: string,
  outDir: string
): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();
  const base = path.basename(originalName, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
  const outPath = path.join(outDir, `${crypto.randomUUID()}-${base}.pdf`);

  if (ext === '.pdf' || (await looksLikePdf(inputPath))) {
    return inputPath;
  }

  if (['.jpg', '.jpeg', '.png'].includes(ext)) {
    await processorLimiter.run(async () => {
      await safeExec(
        'gs',
        [
          '-q',
          '-dNOPAUSE',
          '-dBATCH',
          '-sDEVICE=pdfwrite',
          '-dPDFFitPage',
          '-sOutputFile=' + outPath,
          inputPath
        ],
        45_000
      );
    });
    return outPath;
  }

  if (['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.odp', '.ods'].includes(ext)) {
    if (!(await commandExists('libreoffice'))) {
      throw new Error(
        'Office document conversion is not available on this server (LibreOffice missing). Please upload a PDF.'
      );
    }
    await processorLimiter.run(async () => {
      await safeExec(
        'libreoffice',
        ['--headless', '--convert-to', 'pdf', '--outdir', outDir, inputPath],
        90_000
      );
    });
    const expected = path.join(outDir, `${base}.pdf`);
    try {
      await fs.access(expected);
      return expected;
    } catch {
      const files = await fs.readdir(outDir);
      const generated = files.find((f) => f.toLowerCase().endsWith('.pdf') && f.includes(base));
      if (generated) return path.join(outDir, generated);
      throw new Error('Office document conversion produced no PDF.');
    }
  }

  throw new Error('Unsupported file type. Please upload PDF, DOCX, PPTX, XLSX, JPEG or PNG.');
}

async function looksLikePdf(filePath: string): Promise<boolean> {
  try {
    const handle = await fs.open(filePath, 'r');
    const buf = Buffer.alloc(4);
    await handle.read(buf, 0, 4, 0);
    await handle.close();
    return buf.toString('ascii') === '%PDF';
  } catch {
    return false;
  }
}

async function sha256File(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Full analysis pipeline. Returns the exact PDF that will be printed, its
 * SHA-256 and the per-page colour classification used for billing.
 */
export async function analyzeDocument(
  inputPath: string,
  originalName: string,
  previewDir: string,
  fileId: string,
  options: { maxPages?: number } = {}
): Promise<DocumentAnalysis> {
  const printedPdfPath = await convertToPdf(inputPath, originalName, path.dirname(inputPath));
  const pageCount = await extractPdfPageCount(printedPdfPath);

  if (pageCount <= 0) {
    throw new Error('Could not read the document. It may be corrupt or password-protected.');
  }
  if (options.maxPages && pageCount > options.maxPages) {
    throw new Error(`Document has ${pageCount} pages; the limit is ${options.maxPages} pages per file.`);
  }

  const perPageClassification = await detectPdfColors(printedPdfPath, pageCount);
  const previewFilenames = await generatePdfPreviews(printedPdfPath, previewDir, fileId, 6);
  const stat = await fs.stat(printedPdfPath);

  return {
    pageCount,
    perPageClassification,
    previewFilenames,
    printedPdfPath,
    printedSha256: await sha256File(printedPdfPath),
    printedSizeBytes: stat.size
  };
}
