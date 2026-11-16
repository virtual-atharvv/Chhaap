import WebSocket from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type {
  AgentToCloudMessage,
  CloudToAgentMessage,
  PrinterCapabilities,
  PrintSettings
} from '@chhaap/shared';

const SERVER_WS_URL = process.env.CHHAAP_SERVER_URL || 'ws://localhost:4000/v1/agent/connect';
const AGENT_ID = process.env.CHHAAP_AGENT_ID || 'agent-campus-1';
const AGENT_TOKEN = process.env.CHHAAP_AGENT_TOKEN || 'test_agent_secret_token_123';
const DATA_DIR = path.join(process.cwd(), 'data', 'agent');
const SPOOL_DIR = path.join(DATA_DIR, 'spool');
const OUTPUT_PRINTS_DIR = path.join(process.cwd(), 'test-prints');
const LEDGER_FILE = path.join(DATA_DIR, 'printed-jobs.json');

class PrintAgent {
  private ws: WebSocket | null = null;
  private printedJobIds = new Set<string>();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isDestroyed = false;

  async init() {
    await fs.mkdir(SPOOL_DIR, { recursive: true });
    await fs.mkdir(OUTPUT_PRINTS_DIR, { recursive: true });
    await this.loadLedger();
    this.connect();
  }

  async loadLedger() {
    try {
      const data = await fs.readFile(LEDGER_FILE, 'utf-8');
      const list = JSON.parse(data);
      if (Array.isArray(list)) {
        this.printedJobIds = new Set(list);
      }
    } catch {
      this.printedJobIds = new Set();
    }
  }

  async recordJobPrinted(jobId: string) {
    this.printedJobIds.add(jobId);
    try {
      await fs.writeFile(
        LEDGER_FILE,
        JSON.stringify(Array.from(this.printedJobIds), null, 2)
      );
    } catch (err) {
      console.error('[Agent] Failed to save ledger:', err);
    }
  }

  /**
   * Discovers system printers or provides virtual CUPS-PDF printer
   */
  async discoverPrinters(): Promise<PrinterCapabilities[]> {
    const printers: PrinterCapabilities[] = [];

    // Check if lpstat exists
    try {
      const proc = spawn('lpstat', ['-p', '-d']);
      let stdout = '';
      proc.stdout.on('data', (d) => {
        stdout += d.toString();
      });

      await new Promise((resolve) => proc.on('close', resolve));

      if (stdout) {
        const lines = stdout.split('\n');
        for (const line of lines) {
          const match = line.match(/^printer\s+(\S+)/);
          if (match && match[1]) {
            const name = match[1];
            printers.push({
              systemName: name,
              displayName: `${name} (Local CUPS Printer)`,
              color: true,
              duplex: true,
              papers: ['A4', 'A3', 'Legal'],
              dpi: 600
            });
          }
        }
      }
    } catch {
      // lpstat not available or failed
    }

    // Always ensure Virtual CUPS-PDF printer is present for dev/testing
    if (printers.length === 0) {
      printers.push({
        systemName: 'PDF',
        displayName: 'Virtual CUPS-PDF (Paperless Testing)',
        color: true,
        duplex: true,
        papers: ['A4', 'A3', 'Legal'],
        dpi: 600
      });
    }

    return printers;
  }

  connect() {
    if (this.isDestroyed) return;

    console.log(`[Agent] Connecting outbound to cloud gateway at ${SERVER_WS_URL}...`);
    this.ws = new WebSocket(SERVER_WS_URL);

    this.ws.on('open', async () => {
      console.log('[Agent] WebSocket connection established! Sending handshake hello...');
      const discoveredPrinters = await this.discoverPrinters();

      const helloMsg: AgentToCloudMessage = {
        type: 'hello',
        agentId: AGENT_ID,
        token: AGENT_TOKEN,
        version: '0.1.0',
        os: process.platform,
        printers: discoveredPrinters
      };

      this.ws?.send(JSON.stringify(helloMsg));
    });

    this.ws.on('message', async (data: Buffer | string) => {
      try {
        const msg: CloudToAgentMessage = JSON.parse(data.toString());

        if (msg.type === 'ack') {
          console.log('[Agent] Successfully authenticated with Cloud Gateway! Ready for print jobs.');
        } else if (msg.type === 'ping') {
          const pong: AgentToCloudMessage = {
            type: 'pong',
            timestamp: Date.now()
          };
          this.ws?.send(JSON.stringify(pong));
        } else if (msg.type === 'job.dispatch') {
          await this.handleJobDispatch(msg);
        } else if (msg.type === 'error') {
          console.error('[Agent] Cloud error:', msg.message);
        }
      } catch (err) {
        console.error('[Agent] Error processing cloud message:', err);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.warn(`[Agent] Connection closed (${code}: ${reason.toString()}). Reconnecting in 5s...`);
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[Agent] WebSocket error:', err.message);
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, 5000);
  }

  /**
   * Handles incoming print job from cloud gateway
   */
  async handleJobDispatch(msg: Extract<CloudToAgentMessage, { type: 'job.dispatch' }>) {
    const { jobId, fileUrl, sha256, settings, printerSystemName, documentName } = msg;

    // Idempotency check: did we already print this job?
    if (this.printedJobIds.has(jobId)) {
      console.log(`[Agent] Idempotency guard: Job ${jobId} already printed previously. Resending ok.`);
      const result: AgentToCloudMessage = {
        type: 'job.result',
        jobId,
        ok: true,
        pagesPrinted: 1
      };
      this.ws?.send(JSON.stringify(result));
      return;
    }

    console.log(`[Agent] Received print job ${jobId} for "${documentName}" (${settings.copies} copies, ${settings.colorMode}, ${settings.sides})`);

    // 1. Send accepted
    const accepted: AgentToCloudMessage = {
      type: 'job.accepted',
      jobId
    };
    this.ws?.send(JSON.stringify(accepted));

    const tempFilePath = path.join(SPOOL_DIR, `job_${jobId}_${Date.now()}.pdf`);

    try {
      // 2. Download file
      console.log(`[Agent] Downloading file from ${fileUrl}...`);
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to download file: HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // 3. Verify SHA-256
      const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
      if (actualHash !== sha256) {
        throw new Error(`SHA-256 checksum mismatch! Expected ${sha256}, got ${actualHash}`);
      }

      await fs.writeFile(tempFilePath, buffer);

      // 4. Send progress: spooling
      const spoolProgress: AgentToCloudMessage = {
        type: 'job.progress',
        jobId,
        state: 'spooling'
      };
      this.ws?.send(JSON.stringify(spoolProgress));

      // 5. Execute print
      console.log(`[Agent] Spooling to printer "${printerSystemName}"...`);
      const pagesPrinted = await this.executePrint(tempFilePath, printerSystemName, settings, jobId, documentName);

      // 6. Send progress: printing
      const printProgress: AgentToCloudMessage = {
        type: 'job.progress',
        jobId,
        state: 'printing',
        pagesPrinted
      };
      this.ws?.send(JSON.stringify(printProgress));

      // 7. Privacy: Delete downloaded temporary copy immediately after spooling!
      await fs.unlink(tempFilePath).catch(() => {});
      console.log(`[Agent] Privacy: Deleted local temp spool file ${tempFilePath}`);

      // 8. Record in persistent ledger
      await this.recordJobPrinted(jobId);

      // 9. Send success result
      const result: AgentToCloudMessage = {
        type: 'job.result',
        jobId,
        ok: true,
        pagesPrinted
      };
      this.ws?.send(JSON.stringify(result));
      console.log(`[Agent] Job ${jobId} printed successfully! (${pagesPrinted} pages)`);
    } catch (err: any) {
      console.error(`[Agent] Job ${jobId} failed:`, err.message);
      await fs.unlink(tempFilePath).catch(() => {});

      const result: AgentToCloudMessage = {
        type: 'job.result',
        jobId,
        ok: false,
        pagesPrinted: 0,
        error: err.message
      };
      this.ws?.send(JSON.stringify(result));
    }
  }

  /**
   * Executes printing command (CUPS lp or virtual printer simulation)
   */
  async executePrint(
    filePath: string,
    printerName: string,
    settings: PrintSettings,
    jobId: string,
    documentName: string
  ): Promise<number> {
    // Check if real lp command is available
    let lpAvailable = false;
    try {
      const check = spawn('which', ['lp']);
      await new Promise((resolve, reject) => {
        check.on('close', (code) => {
          if (code === 0) lpAvailable = true;
          resolve(true);
        });
        check.on('error', () => resolve(true));
      });
    } catch {
      lpAvailable = false;
    }

    if (lpAvailable && printerName !== 'PDF') {
      // Execute CUPS lp command (implementation.md §5.3.1)
      const args = [
        '-d',
        printerName,
        '-n',
        settings.copies.toString(),
        '-o',
        settings.sides === 'duplex' ? 'sides=two-sided-long-edge' : 'sides=one-sided',
        '-o',
        settings.colorMode === 'bw' ? 'ColorModel=Gray' : 'ColorModel=Color',
        '-o',
        `media=${settings.paperSize}`,
        '-o',
        `number-up=${settings.pagesPerSheet || 1}`,
        filePath
      ];

      return new Promise((resolve, reject) => {
        const proc = spawn('lp', args);
        let stderr = '';
        proc.stderr.on('data', (d) => {
          stderr += d.toString();
        });
        proc.on('close', (code) => {
          if (code === 0) {
            resolve(settings.copies);
          } else {
            reject(new Error(`CUPS lp command failed (code ${code}): ${stderr}`));
          }
        });
      });
    } else {
      // Virtual CUPS-PDF printer mode (dev & testing loop)
      // Save to OUTPUT_PRINTS_DIR
      const cleanDocName = documentName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const outPath = path.join(OUTPUT_PRINTS_DIR, `PRINTED_${jobId}_${cleanDocName}`);
      await fs.copyFile(filePath, outPath);

      // Simulate realistic print spool time (400ms)
      await new Promise((resolve) => setTimeout(resolve, 400));
      console.log(`[Virtual CUPS-PDF] Saved printed output to ${outPath}`);
      return settings.copies;
    }
  }

  stop() {
    this.isDestroyed = true;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) this.ws.close();
  }
}

const agent = new PrintAgent();
agent.init().catch(console.error);

process.on('SIGINT', () => {
  agent.stop();
  process.exit(0);
});
