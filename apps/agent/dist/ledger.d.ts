import type { UnfinishedJob } from '@chhaap/shared';
export type LedgerState = 'accepted' | 'downloading' | 'spooling' | 'printing' | 'printed' | 'failed';
interface LedgerEntry {
    jobId: string;
    state: LedgerState;
    pagesPrinted: number;
    documentName?: string;
    updatedAt: string;
}
/**
 * Durable record of jobs the agent has seen. The critical invariant is: once a
 * job reaches `printing`, a crash must never cause it to print again. `printing`
 * is written to disk *before* the spooler is invoked, and `printed` after it
 * succeeds. On startup a stale `printing` entry is reported to the server as
 * unfinished, which makes the server reconcile it as assumed printed.
 */
export declare class JobLedger {
    private readonly filePath;
    private data;
    private writing;
    constructor(filePath: string);
    load(): Promise<void>;
    has(jobId: string): boolean;
    resultFor(jobId: string): LedgerEntry | undefined;
    unfinished(): UnfinishedJob[];
    set(jobId: string, state: LedgerState, detail?: {
        pagesPrinted?: number;
        documentName?: string;
    }): Promise<void>;
    private trim;
    /** Serialises writes and uses rename for crash-safe atomic replacement. */
    private persist;
}
export {};
//# sourceMappingURL=ledger.d.ts.map