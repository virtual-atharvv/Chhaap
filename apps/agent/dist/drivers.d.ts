import type { PrintSettings, PrinterCapabilities, PrinterStatus } from '@chhaap/shared';
export interface PrintOptions {
    settings: PrintSettings;
    pageCount: number;
    documentName: string;
    jobId: string;
}
export interface PrintResult {
    pagesPrinted: number;
    /** Raw spooler identifier when the platform provides one. */
    spoolId?: string;
}
export interface PrinterDriver {
    readonly printerSystemName: string;
    print(filePath: string, options: PrintOptions): Promise<PrintResult>;
}
export interface DriverEnvironment {
    outputDir: string;
    virtualPrinter: boolean;
    sumatraPath?: string;
}
/** execFile wrapper: argument arrays only, bounded output, hard timeout. */
export declare function runCommand(command: string, args: string[], timeoutMs?: number): Promise<{
    stdout: string;
    stderr: string;
}>;
/**
 * CUPS driver for Linux/macOS. The file is always a print-ready PDF produced
 * by the server, so no client-side rendering happens here.
 */
export declare class CupsDriver implements PrinterDriver {
    readonly printerSystemName: string;
    private readonly jobTimeoutMs;
    constructor(printerSystemName: string, jobTimeoutMs?: number);
    print(filePath: string, options: PrintOptions): Promise<PrintResult>;
}
/**
 * Virtual printer for tests and Linux development without CUPS. It writes the
 * exact PDF the agent received, which lets tests assert that the bytes printed
 * match the server-side SHA-256.
 */
export declare class VirtualPdfDriver implements PrinterDriver {
    readonly printerSystemName: string;
    private readonly outputDir;
    private readonly spoolDelayMs;
    constructor(printerSystemName: string, outputDir: string, spoolDelayMs?: number);
    print(filePath: string, options: PrintOptions): Promise<PrintResult>;
}
/**
 * Windows driver. SumatraPDF is used because it renders PDFs identically to
 * the server's print-ready file and exposes duplex/colour/copies flags on the
 * command line. Real spooler failures surface as a non-zero exit code.
 */
export declare class WindowsSumatraDriver implements PrinterDriver {
    readonly printerSystemName: string;
    private readonly jobTimeoutMs;
    private readonly sumatraPath;
    constructor(printerSystemName: string, configuredPath?: string, jobTimeoutMs?: number);
    print(filePath: string, options: PrintOptions): Promise<PrintResult>;
}
/**
 * Reads current device state. CUPS reports disabled reasons (paper out,
 * offline); Windows exposes a PrinterStatus enum. Unknown failures are
 * reported as `error`, not `offline`, so the owner alert says something useful.
 */
export declare function queryPrinterStatus(systemName: string, virtualPrinter?: boolean): Promise<PrinterStatus>;
export interface DiscoveryOptions {
    virtualPrinter: boolean;
    platform?: NodeJS.Platform;
}
/**
 * Discovers real printers first. A virtual PDF printer is added only when
 * explicitly enabled (dev/test) or when no real CUPS printer is available on
 * Linux; Windows production never silently falls back to "printing" a file.
 */
export declare function discoverPrinters(options?: DiscoveryOptions): Promise<PrinterCapabilities[]>;
/**
 * Picks a driver for a dispatched job. The server tells us the system name it
 * expects; if an operator points it at a missing printer we fail the job
 * rather than silently printing somewhere else.
 */
export declare function createDriver(printerSystemName: string, env: DriverEnvironment): PrinterDriver;
//# sourceMappingURL=drivers.d.ts.map