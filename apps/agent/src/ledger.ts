import fs from 'node:fs/promises';
import path from 'node:path';
import type { UnfinishedJob } from '@chhaap/shared';

export type LedgerState =
  | 'accepted'
  | 'downloading'
  | 'spooling'
  | 'printing'
  | 'printed'
  | 'failed';

interface LedgerEntry {
  jobId: string;
  state: LedgerState;
  pagesPrinted: number;
  documentName?: string;
  updatedAt: string;
}

interface LedgerFile {
  version: 1;
  entries: Record<string, LedgerEntry>;
}

const MAX_ENTRIES = 5000;

/**
 * Durable record of jobs the agent has seen. The critical invariant is: once a
 * job reaches `printing`, a crash must never cause it to print again. `printing`
 * is written to disk *before* the spooler is invoked, and `printed` after it
 * succeeds. On startup a stale `printing` entry is reported to the server as
 * unfinished, which makes the server reconcile it as assumed printed.
 */
export class JobLedger {
  private data: LedgerFile = { version: 1, entries: {} };
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as LedgerFile;
      if (parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object') {
        this.data = parsed;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[Agent] Could not read job ledger; starting fresh:', (err as Error).message);
      }
      this.data = { version: 1, entries: {} };
    }
  }

  has(jobId: string): boolean {
    return this.data.entries[jobId]?.state === 'printed';
  }

  resultFor(jobId: string): LedgerEntry | undefined {
    return this.data.entries[jobId];
  }

  unfinished(): UnfinishedJob[] {
    return Object.values(this.data.entries)
      .filter((entry) => entry.state === 'accepted' || entry.state === 'downloading' || entry.state === 'spooling' || entry.state === 'printing')
      .map((entry) => ({ jobId: entry.jobId, state: entry.state as UnfinishedJob['state'] }));
  }

  async set(
    jobId: string,
    state: LedgerState,
    detail: { pagesPrinted?: number; documentName?: string } = {}
  ): Promise<void> {
    const previous = this.data.entries[jobId];
    if (previous?.state === 'printed' && state !== 'printed') return;
    this.data.entries[jobId] = {
      jobId,
      state,
      pagesPrinted: detail.pagesPrinted ?? previous?.pagesPrinted ?? 0,
      documentName: detail.documentName ?? previous?.documentName,
      updatedAt: new Date().toISOString()
    };
    this.trim();
    await this.persist();
  }

  private trim(): void {
    const entries = Object.values(this.data.entries);
    if (entries.length <= MAX_ENTRIES) return;
    entries
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, entries.length - MAX_ENTRIES)
      .forEach((entry) => delete this.data.entries[entry.jobId]);
  }

  /** Serialises writes and uses rename for crash-safe atomic replacement. */
  private persist(): Promise<void> {
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temp = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      await fs.rename(temp, this.filePath);
    });
    return this.writing.catch((err) => {
      console.error('[Agent] Failed to persist job ledger:', (err as Error).message);
    });
  }
}
