import type { DocumentAnalysis, PageClassification } from '@chhaap/shared';
/**
 * Executes an external binary using execFile with argument arrays (never a
 * shell string), a timeout and a bounded output buffer.
 */
export declare function safeExec(file: string, args: string[], timeoutMs?: number): Promise<string>;
export declare function extractPdfPageCount(filePath: string): Promise<number>;
export declare function detectPdfColors(filePath: string, totalPages: number): Promise<PageClassification[]>;
export declare function generatePdfPreviews(filePath: string, outDir: string, fileId: string, maxPages?: number): Promise<string[]>;
/**
 * Converts any accepted upload to a print-ready PDF. The agent only ever
 * receives PDFs, which eliminates Windows-driver/font inconsistencies.
 */
export declare function convertToPdf(inputPath: string, originalName: string, outDir: string): Promise<string>;
/**
 * Full analysis pipeline. Returns the exact PDF that will be printed, its
 * SHA-256 and the per-page colour classification used for billing.
 */
export declare function analyzeDocument(inputPath: string, originalName: string, previewDir: string, fileId: string, options?: {
    maxPages?: number;
}): Promise<DocumentAnalysis>;
//# sourceMappingURL=document-processor.d.ts.map