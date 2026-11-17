import { loadEnv } from './env.js';
loadEnv();
import WebSocket from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDriver, discoverPrinters, queryPrinterStatus } from './drivers.js';
import { JobLedger } from './ledger.js';
const AGENT_VERSION = '0.2.0';
const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024;
const MAX_RECONNECT_MS = 30_000;
function defaultDataDir() {
    if (process.env.CHHAAP_DATA_DIR)
        return path.resolve(process.env.CHHAAP_DATA_DIR);
    if (process.platform === 'win32' && process.env.ProgramData) {
        return path.join(process.env.ProgramData, 'Chhaap');
    }
    return path.resolve(process.cwd(), 'data', 'agent');
}
function normalizeServerUrl(value) {
    const trimmed = value.trim().replace(/\/$/, '');
    const isWs = trimmed.startsWith('ws://') || trimmed.startsWith('wss://');
    let httpBase;
    let wsUrl;
    if (isWs) {
        wsUrl = trimmed.includes('/v1/agent/connect')
            ? trimmed
            : `${trimmed}/v1/agent/connect`;
        httpBase = wsUrl.replace(/^ws/, 'http').replace(/\/v1\/agent\/connect$/, '');
    }
    else {
        httpBase = trimmed.replace(/\/v1\/agent\/connect$/, '');
        wsUrl = `${httpBase.replace(/^http/, 'ws')}/v1/agent/connect`;
    }
    return { httpBase, wsUrl };
}
async function readStoredConfig(dataDir) {
    try {
        return JSON.parse(await fs.readFile(path.join(dataDir, 'config.json'), 'utf-8'));
    }
    catch {
        return {};
    }
}
async function writeStoredConfig(dataDir, config) {
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const file = path.join(dataDir, 'config.json');
    await fs.writeFile(file, JSON.stringify(config, null, 2), { mode: 0o600 });
}
async function pairAgent(httpBase, pairingCode, agentName) {
    const res = await fetch(`${httpBase}/v1/agents/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            pairingCode,
            agentName,
            os: process.platform
        })
    });
    const data = (await res.json().catch(() => ({})));
    if (!res.ok || !data.agentId || !data.token) {
        throw new Error(data.error || `Pairing failed (HTTP ${res.status})`);
    }
    return {
        agentId: data.agentId,
        token: data.token,
        agentName,
        serverUrl: data.wsUrl || `${httpBase}/v1/agent/connect`
    };
}
async function loadConfig() {
    const dataDir = defaultDataDir();
    const stored = await readStoredConfig(dataDir);
    const serverUrl = process.env.CHHAAP_SERVER_URL || stored.serverUrl || 'http://localhost:4000';
    const { httpBase } = normalizeServerUrl(serverUrl);
    const pairingCode = process.argv.find((arg) => arg.startsWith('--pair='))?.split('=')[1] ||
        process.env.CHHAAP_PAIRING_CODE;
    const agentName = process.env.CHHAAP_AGENT_NAME || stored.agentName || 'Shop PC Agent';
    if (pairingCode) {
        console.log('[Agent] Pairing with the shop cloud using the one-time code…');
        const paired = await pairAgent(httpBase, pairingCode, agentName);
        await writeStoredConfig(dataDir, { ...stored, ...paired });
        Object.assign(stored, paired);
    }
    const agentId = process.env.CHHAAP_AGENT_ID || stored.agentId || '';
    const token = process.env.CHHAAP_AGENT_TOKEN || stored.token || '';
    if (!agentId || !token) {
        throw new Error('Agent is not paired. Generate a pairing code in the shop dashboard and run: node dist/index.js --pair=<code> (or set CHHAAP_PAIRING_CODE).');
    }
    return {
        serverUrl,
        agentId,
        token,
        agentName,
        virtualPrinter: process.env.CHHAAP_VIRTUAL_PRINTER === '1' ||
            process.env.CHHAAP_VIRTUAL_PRINTER === 'true',
        dataDir,
        outputDir: path.resolve(process.env.CHHAAP_PRINT_OUTPUT_DIR || path.join(dataDir, 'prints')),
        sumatraPath: process.env.CHHAAP_SUMATRA_PATH
    };
}
class PrintAgent {
    config;
    wsUrl;
    httpBase;
    ws = null;
    reconnectTimer = null;
    reconnectAttempt = 0;
    stopped = false;
    ledger;
    discovered = new Map();
    driverEnv;
    lastStatus = new Map();
    statusTimer = null;
    jobQueue = Promise.resolve();
    printedPrinterIds = new Map();
    constructor(config, wsUrl, httpBase) {
        this.config = config;
        this.wsUrl = wsUrl;
        this.httpBase = httpBase;
        this.ledger = new JobLedger(path.join(config.dataDir, 'printed-jobs.json'));
        this.driverEnv = {
            outputDir: config.outputDir,
            virtualPrinter: config.virtualPrinter,
            sumatraPath: config.sumatraPath
        };
    }
    async start() {
        await this.ledger.load();
        await fs.mkdir(path.join(this.config.dataDir, 'spool'), { recursive: true, mode: 0o700 });
        await fs.mkdir(this.config.outputDir, { recursive: true, mode: 0o700 });
        await this.cleanSpool();
        this.connect();
        this.statusTimer = setInterval(() => {
            void this.reportPrinterStatus();
        }, 45_000);
        this.statusTimer.unref?.();
    }
    connect() {
        if (this.stopped)
            return;
        console.log(`[Agent] Connecting to ${this.wsUrl} …`);
        const ws = new WebSocket(this.wsUrl, { handshakeTimeout: 15_000 });
        this.ws = ws;
        ws.on('open', () => {
            void this.sendHello();
        });
        ws.on('message', (raw) => {
            let message;
            try {
                message = JSON.parse(raw.toString());
            }
            catch {
                console.warn('[Agent] Ignoring malformed cloud message');
                return;
            }
            void this.handleMessage(message);
        });
        ws.on('close', (code, reason) => {
            if (this.ws === ws)
                this.ws = null;
            if (this.stopped)
                return;
            if (code === 4000 || code === 4001) {
                console.error(`[Agent] Authentication/permanent failure (${code}: ${reason.toString()}). Re-pair required.`);
                return;
            }
            this.scheduleReconnect();
        });
        ws.on('error', (err) => {
            console.error('[Agent] WebSocket error:', err.message);
        });
    }
    async sendHello() {
        try {
            const printers = await discoverPrinters({ virtualPrinter: this.config.virtualPrinter });
            this.discovered.clear();
            for (const printer of printers)
                this.discovered.set(printer.systemName, printer);
            const hello = {
                type: 'hello',
                agentId: this.config.agentId,
                token: this.config.token,
                version: AGENT_VERSION,
                os: `${process.platform}-${process.arch}`,
                printers,
                unfinishedJobs: this.ledger.unfinished(),
                unfinishedJobIds: []
            };
            this.send(hello);
        }
        catch (err) {
            console.error('[Agent] Could not build hello:', err.message);
            this.ws?.close(4003, 'Hello failed');
        }
    }
    async handleMessage(message) {
        if (message.type === 'ack') {
            this.reconnectAttempt = 0;
            this.printedPrinterIds.clear();
            for (const printer of message.config.printers ?? []) {
                this.printedPrinterIds.set(printer.systemName, printer.id);
            }
            const minVersion = message.config.minAgentVersion;
            if (minVersion && compareVersions(AGENT_VERSION, minVersion) < 0) {
                console.error(`[Agent] This agent (${AGENT_VERSION}) is older than the minimum supported version ${minVersion}. Please update.`);
            }
            console.log('[Agent] Paired with cloud gateway. Waiting for print jobs.');
            await this.reportPrinterStatus(true);
            return;
        }
        if (message.type === 'ping') {
            this.send({ type: 'pong', timestamp: Date.now() });
            return;
        }
        if (message.type === 'error') {
            console.error('[Agent] Cloud error:', message.message);
            return;
        }
        if (message.type === 'job.dispatch') {
            // Serialise jobs: one spooler at a time keeps page accounting and
            // ledger ordering deterministic.
            this.jobQueue = this.jobQueue
                .then(() => this.handleJob(message))
                .catch((err) => console.error('[Agent] Job queue error:', err.message));
        }
    }
    async handleJob(message) {
        const { jobId, fileUrl, sha256, settings, printerSystemName, documentName, pageCount } = message;
        const existing = this.ledger.resultFor(jobId);
        if (existing && (existing.state === 'printed' || existing.state === 'printing' || existing.state === 'spooling')) {
            // Already printed or was mid-print before a crash. Never print twice.
            console.log(`[Agent] Job ${jobId} is already ${existing.state}; reporting success without reprinting.`);
            this.send({
                type: 'job.result',
                jobId,
                ok: true,
                pagesPrinted: existing.pagesPrinted || Math.max(1, pageCount) * Math.max(1, settings.copies)
            });
            return;
        }
        if (!this.discovered.has(printerSystemName)) {
            this.send({
                type: 'job.result',
                jobId,
                ok: false,
                pagesPrinted: 0,
                error: `printer_not_found: ${printerSystemName}`
            });
            return;
        }
        console.log(`[Agent] Job ${jobId}: "${documentName}" → ${printerSystemName}`);
        this.send({ type: 'job.accepted', jobId });
        const tempPath = path.join(this.config.dataDir, 'spool', `job_${jobId.replace(/[^a-zA-Z0-9-]/g, '_')}_${Date.now()}.pdf`);
        try {
            await this.ledger.set(jobId, 'downloading', { documentName });
            this.send({ type: 'job.progress', jobId, state: 'downloading' });
            const buffer = await this.download(fileUrl);
            const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
            if (actualHash !== sha256) {
                throw new HashMismatchError(`hash_mismatch: expected ${sha256}, got ${actualHash}`);
            }
            await fs.writeFile(tempPath, buffer, { mode: 0o600 });
            await this.ledger.set(jobId, 'spooling', { documentName });
            this.send({ type: 'job.progress', jobId, state: 'spooling' });
            const driver = createDriver(printerSystemName, this.driverEnv);
            await this.ledger.set(jobId, 'printing', { documentName });
            this.send({ type: 'job.progress', jobId, state: 'printing' });
            const result = await driver.print(tempPath, {
                settings,
                pageCount,
                documentName,
                jobId
            });
            await this.ledger.set(jobId, 'printed', {
                pagesPrinted: result.pagesPrinted,
                documentName
            });
            this.send({
                type: 'job.result',
                jobId,
                ok: true,
                pagesPrinted: result.pagesPrinted
            });
            console.log(`[Agent] Job ${jobId} printed (${result.pagesPrinted} pages).`);
        }
        catch (err) {
            await this.ledger.set(jobId, 'failed', { documentName });
            const messageText = err instanceof HashMismatchError ? err.message : `print_failed: ${err.message}`;
            console.error(`[Agent] Job ${jobId} failed: ${messageText}`);
            this.send({
                type: 'job.result',
                jobId,
                ok: false,
                pagesPrinted: 0,
                error: messageText
            });
        }
        finally {
            // Privacy: the spool copy is removed even when the spooler failed.
            await fs.unlink(tempPath).catch(() => { });
        }
    }
    async download(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60_000);
        try {
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok)
                throw new Error(`download_failed: HTTP ${res.status}`);
            const length = Number(res.headers.get('content-length') || 0);
            if (length > MAX_DOWNLOAD_BYTES)
                throw new Error('download_failed: file too large');
            const buffer = Buffer.from(await res.arrayBuffer());
            if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
                throw new Error('download_failed: file too large');
            }
            return buffer;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async reportPrinterStatus(force = false) {
        for (const [systemName] of this.discovered) {
            const printerId = this.printedPrinterIds.get(systemName);
            if (!printerId)
                continue;
            const status = await queryPrinterStatus(systemName, this.config.virtualPrinter);
            if (!force && this.lastStatus.get(systemName) === status)
                continue;
            this.lastStatus.set(systemName, status);
            this.send({ type: 'printer.status', printerId, status });
        }
    }
    scheduleReconnect() {
        if (this.reconnectTimer || this.stopped)
            return;
        const base = Math.min(MAX_RECONNECT_MS, 1000 * 2 ** this.reconnectAttempt);
        const jitter = base * (0.7 + Math.random() * 0.6);
        this.reconnectAttempt++;
        const delay = Math.round(jitter);
        console.log(`[Agent] Reconnecting in ${delay} ms (attempt ${this.reconnectAttempt}).`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
        this.reconnectTimer.unref?.();
    }
    send(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
            return;
        try {
            this.ws.send(JSON.stringify(message));
        }
        catch (err) {
            console.warn('[Agent] Could not send message:', err.message);
        }
    }
    async cleanSpool() {
        const spoolDir = path.join(this.config.dataDir, 'spool');
        try {
            const files = await fs.readdir(spoolDir);
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;
            for (const file of files) {
                const full = path.join(spoolDir, file);
                try {
                    const stat = await fs.stat(full);
                    if (stat.mtimeMs < cutoff)
                        await fs.unlink(full);
                }
                catch {
                    // ignore individual files
                }
            }
        }
        catch {
            // spool does not exist yet
        }
    }
    stop() {
        this.stopped = true;
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        if (this.statusTimer)
            clearInterval(this.statusTimer);
        this.ws?.close(1000, 'Agent shutting down');
    }
}
class HashMismatchError extends Error {
}
function compareVersions(a, b) {
    const parse = (v) => v.split('.').map((n) => parseInt(n, 10) || 0);
    const pa = parse(a);
    const pb = parse(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0)
            return diff > 0 ? 1 : -1;
    }
    return 0;
}
async function main() {
    const config = await loadConfig();
    const normalized = normalizeServerUrl(config.serverUrl);
    const agent = new PrintAgent(config, normalized.wsUrl, normalized.httpBase);
    const shutdown = () => {
        console.log('[Agent] Shutting down…');
        agent.stop();
        setTimeout(() => process.exit(0), 300).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    await agent.start();
}
main().catch((err) => {
    console.error('[Agent] Fatal:', err.message);
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map