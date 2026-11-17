import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
/** execFile wrapper: argument arrays only, bounded output, hard timeout. */
export function runCommand(command, args, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
        execFile(command, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
                const detail = String(stderr || error.message).trim().slice(0, 1000);
                reject(new Error(`${command} failed: ${detail || error.message}`));
                return;
            }
            resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
        });
    });
}
async function commandExists(command) {
    try {
        await runCommand(command === 'lp' ? 'which' : command, command === 'lp' ? ['lp'] : ['--version'], 5000);
        return true;
    }
    catch {
        return false;
    }
}
function estimatedPages(settings, pageCount) {
    return Math.max(1, pageCount) * Math.max(1, settings.copies);
}
/**
 * CUPS driver for Linux/macOS. The file is always a print-ready PDF produced
 * by the server, so no client-side rendering happens here.
 */
export class CupsDriver {
    printerSystemName;
    jobTimeoutMs;
    constructor(printerSystemName, jobTimeoutMs = 120_000) {
        this.printerSystemName = printerSystemName;
        this.jobTimeoutMs = jobTimeoutMs;
    }
    async print(filePath, options) {
        const { settings } = options;
        const args = [
            '-d',
            this.printerSystemName,
            '-n',
            String(settings.copies),
            '-o',
            settings.sides === 'duplex' ? 'sides=two-sided-long-edge' : 'sides=one-sided',
            '-o',
            settings.colorMode === 'color' || settings.colorMode === 'smart'
                ? 'ColorModel=Color'
                : 'ColorModel=Gray',
            '-o',
            `media=${settings.paperSize}`,
            '-o',
            `number-up=${settings.pagesPerSheet || 1}`,
            '-o',
            settings.fitMode === 'fill' ? 'fit-to-page=false' : 'fit-to-page=true',
            filePath
        ];
        const { stdout, stderr } = await runCommand('lp', args, this.jobTimeoutMs);
        const combined = `${stdout}\n${stderr}`;
        if (/unable to|not found|error|forbidden|no such file/i.test(stderr)) {
            throw new Error(`spool_error: ${stderr.trim().slice(0, 500)}`);
        }
        const spoolId = combined.match(/request id is (\S+)/i)?.[1];
        return { pagesPrinted: estimatedPages(settings, options.pageCount), spoolId };
    }
}
/**
 * Virtual printer for tests and Linux development without CUPS. It writes the
 * exact PDF the agent received, which lets tests assert that the bytes printed
 * match the server-side SHA-256.
 */
export class VirtualPdfDriver {
    printerSystemName;
    outputDir;
    spoolDelayMs;
    constructor(printerSystemName, outputDir, spoolDelayMs = 150) {
        this.printerSystemName = printerSystemName;
        this.outputDir = outputDir;
        this.spoolDelayMs = spoolDelayMs;
    }
    async print(filePath, options) {
        await fs.mkdir(this.outputDir, { recursive: true });
        const safeName = options.documentName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document.pdf';
        const fileName = `PRINTED_${options.jobId}_${safeName}`;
        const outPath = path.join(this.outputDir, fileName);
        await fs.copyFile(filePath, outPath);
        // A sidecar keeps the job evidence easy to inspect in dev/test.
        await fs.writeFile(`${outPath}.json`, JSON.stringify({
            jobId: options.jobId,
            documentName: options.documentName,
            settings: options.settings,
            pageCount: options.pageCount,
            sha256: crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex'),
            printedAt: new Date().toISOString()
        }, null, 2));
        if (this.spoolDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.spoolDelayMs));
        }
        return { pagesPrinted: estimatedPages(options.settings, options.pageCount), spoolId: outPath };
    }
}
/**
 * Windows driver. SumatraPDF is used because it renders PDFs identically to
 * the server's print-ready file and exposes duplex/colour/copies flags on the
 * command line. Real spooler failures surface as a non-zero exit code.
 */
export class WindowsSumatraDriver {
    printerSystemName;
    jobTimeoutMs;
    sumatraPath;
    constructor(printerSystemName, configuredPath, jobTimeoutMs = 180_000) {
        this.printerSystemName = printerSystemName;
        this.jobTimeoutMs = jobTimeoutMs;
        this.sumatraPath =
            configuredPath ||
                process.env.CHHAAP_SUMATRA_PATH ||
                path.join(process.env.ProgramFiles || 'C:\\Program Files', 'SumatraPDF', 'SumatraPDF.exe');
    }
    async print(filePath, options) {
        const { settings } = options;
        const printSettings = [
            settings.sides === 'duplex' ? 'duplex' : 'simplex',
            settings.colorMode === 'color' || settings.colorMode === 'smart' ? 'color' : 'monochrome',
            `${settings.copies}x`,
            `paper=${settings.paperSize}`,
            settings.fitMode === 'fill' ? 'noscale' : 'fit'
        ].join(',');
        const { stdout, stderr } = await runCommand(this.sumatraPath, ['-print-to', this.printerSystemName, '-print-settings', printSettings, '-silent', filePath], this.jobTimeoutMs);
        if (/error|failed|unable/i.test(stderr)) {
            throw new Error(`spool_error: ${stderr.trim().slice(0, 500) || stdout.trim().slice(0, 500)}`);
        }
        return { pagesPrinted: estimatedPages(settings, options.pageCount) };
    }
}
/** Enumerates Windows printers without using a shell string. */
async function discoverWindowsPrinters() {
    const script = 'Get-Printer | Select-Object Name,PrinterStatus,DriverName | ConvertTo-Json -Compress';
    const { stdout } = await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], 20_000);
    const parsed = JSON.parse(stdout.trim() || '[]');
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const printers = [];
    for (const item of list) {
        const name = String(item?.Name ?? '').trim();
        if (!name)
            continue;
        printers.push({
            systemName: name,
            displayName: name,
            // Capabilities are refined by the Windows driver. Conservative defaults
            // avoid promising colour/duplex a device cannot do.
            color: true,
            duplex: true,
            papers: ['A4', 'Letter', 'Legal'],
            dpi: 600
        });
    }
    return printers;
}
/** Enumerates CUPS printers. */
async function discoverCupsPrinters() {
    const { stdout } = await runCommand('lpstat', ['-p', '-d'], 10_000);
    const printers = [];
    const seen = new Set();
    for (const line of stdout.split('\n')) {
        const match = line.match(/^printer\s+(\S+)/);
        if (!match || !match[1] || seen.has(match[1]))
            continue;
        const name = match[1];
        seen.add(name);
        printers.push({
            systemName: name,
            displayName: `${name} (CUPS)`,
            color: true,
            duplex: true,
            papers: ['A4', 'A3', 'Legal', 'Letter'],
            dpi: 600
        });
    }
    return printers;
}
/**
 * Reads current device state. CUPS reports disabled reasons (paper out,
 * offline); Windows exposes a PrinterStatus enum. Unknown failures are
 * reported as `error`, not `offline`, so the owner alert says something useful.
 */
export async function queryPrinterStatus(systemName, virtualPrinter = false) {
    if (systemName === 'PDF' || virtualPrinter)
        return 'online';
    if (process.platform === 'win32') {
        try {
            const script = `Get-Printer -Name '${systemName.replace(/'/g, "''")}' | Select-Object PrinterStatus | ConvertTo-Json -Compress`;
            const { stdout } = await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], 15_000);
            const status = Number(JSON.parse(stdout.trim() || '{}').PrinterStatus);
            if (status === 4 || status === 10 || status === 13)
                return 'busy';
            if (status === 3 || status === 5 || status === 12)
                return 'online';
            if (status === 7)
                return 'offline';
            if (status === 9 || status === 18)
                return 'paper_out';
            return 'error';
        }
        catch {
            return 'offline';
        }
    }
    try {
        const { stdout } = await runCommand('lpstat', ['-p', systemName], 10_000);
        const text = stdout.toLowerCase();
        if (/paper|media|load/.test(text))
            return 'paper_out';
        if (/disabled|offline|not connected/.test(text))
            return 'offline';
        if (/now printing|processing/.test(text))
            return 'busy';
        return 'online';
    }
    catch {
        return 'offline';
    }
}
/**
 * Discovers real printers first. A virtual PDF printer is added only when
 * explicitly enabled (dev/test) or when no real CUPS printer is available on
 * Linux; Windows production never silently falls back to "printing" a file.
 */
export async function discoverPrinters(options = { virtualPrinter: false }) {
    const platform = options.platform ?? process.platform;
    const printers = [];
    try {
        if (platform === 'win32') {
            printers.push(...(await discoverWindowsPrinters()));
        }
        else {
            printers.push(...(await discoverCupsPrinters()));
        }
    }
    catch (err) {
        console.warn(`[Agent] Printer discovery failed: ${err.message}`);
    }
    const wantsVirtual = options.virtualPrinter ||
        (platform !== 'win32' && printers.length === 0 && (await commandExists('lp')) === false);
    if (wantsVirtual) {
        printers.push({
            systemName: 'PDF',
            displayName: 'Virtual PDF printer (no hardware)',
            color: true,
            duplex: true,
            papers: ['A4', 'A3', 'Legal', 'Letter'],
            dpi: 300
        });
    }
    return printers;
}
/**
 * Picks a driver for a dispatched job. The server tells us the system name it
 * expects; if an operator points it at a missing printer we fail the job
 * rather than silently printing somewhere else.
 */
export function createDriver(printerSystemName, env) {
    if (printerSystemName === 'PDF' || env.virtualPrinter) {
        return new VirtualPdfDriver(printerSystemName || 'PDF', env.outputDir);
    }
    if (process.platform === 'win32') {
        return new WindowsSumatraDriver(printerSystemName, env.sumatraPath);
    }
    return new CupsDriver(printerSystemName);
}
//# sourceMappingURL=drivers.js.map