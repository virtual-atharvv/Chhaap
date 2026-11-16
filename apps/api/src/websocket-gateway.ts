import type { WebSocket } from 'ws';
import { db, type OrderRecord, type PrintJobRecord } from '@chhaap/db';
import type {
  AgentToCloudMessage,
  CloudToAgentMessage,
  OrderStatus,
  UnfinishedJob
} from '@chhaap/shared';
import { storage } from './storage.js';
import { loadConfig } from './config.js';
import { orderNotifier } from './whatsapp/notifier.js';
import { shopOwnerAlerts } from './whatsapp/owner-alerts.js';

interface ConnectedAgent {
  agentId: string;
  shopId: string;
  ws: WebSocket;
  lastSeen: number;
}

type OrderSubscriber = (status: OrderStatus, data: Record<string, unknown>) => void;

const HEARTBEAT_INTERVAL_MS = 20_000;

export class WebSocketGateway {
  private connectedAgents = new Map<string, ConnectedAgent>();
  private orderSubscribers = new Map<string, Set<OrderSubscriber>>();
  private serverBaseUrl = 'http://localhost:4000';
  private heartbeatTimer: NodeJS.Timeout | null = null;

  setBaseUrl(url: string): void {
    this.serverBaseUrl = url;
  }

  /** Starts the ping/offline scanner once per process. Safe to call twice. */
  start(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeatScan();
    }, 10_000);
    this.heartbeatTimer.unref?.();
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const agent of this.connectedAgents.values()) {
      try {
        agent.ws.close(1001, 'Server shutting down');
      } catch {
        // ignore
      }
    }
    this.connectedAgents.clear();
  }

  // --- SSE subscriptions for customer web clients ---
  subscribeOrder(orderId: string, callback: OrderSubscriber): () => void {
    const set = this.orderSubscribers.get(orderId) ?? new Set<OrderSubscriber>();
    set.add(callback);
    this.orderSubscribers.set(orderId, set);
    return () => {
      const current = this.orderSubscribers.get(orderId);
      if (!current) return;
      current.delete(callback);
      if (current.size === 0) this.orderSubscribers.delete(orderId);
    };
  }

  notifyOrderStatus(
    orderId: string,
    status: OrderStatus,
    data: Record<string, unknown> = {}
  ): void {
    const subscribers = this.orderSubscribers.get(orderId);
    if (!subscribers) return;
    for (const cb of subscribers) {
      try {
        cb(status, data);
      } catch (err) {
        console.error('[Gateway] SSE subscriber failed:', err);
      }
    }
  }

  // --- Agent WebSocket connection handler ---
  handleAgentConnection(ws: WebSocket): void {
    this.start();
    let currentAgentId: string | null = null;

    const reject = (message: string) => {
      this.sendToSocket(ws, { type: 'error', message });
      ws.close(4001, 'Unauthorized');
    };

    ws.on('message', async (data: Buffer | string) => {
      let msg: AgentToCloudMessage;
      try {
        msg = JSON.parse(data.toString()) as AgentToCloudMessage;
      } catch {
        this.sendToSocket(ws, { type: 'error', message: 'Invalid JSON message' });
        return;
      }

      try {
        switch (msg.type) {
          case 'hello': {
            const config = loadConfig();
            const agent = await db.getAgentByToken(msg.token, config.agentTokenPepper);
            if (!agent || agent.id !== msg.agentId) {
              reject('Authentication failed: invalid agent ID or token');
              return;
            }

            currentAgentId = agent.id;
            const existing = this.connectedAgents.get(agent.id);
            if (existing && existing.ws !== ws) {
              try {
                existing.ws.close(4000, 'Replaced by a newer connection');
              } catch {
                // ignore
              }
            }

            this.connectedAgents.set(agent.id, {
              agentId: agent.id,
              shopId: agent.shopId,
              ws,
              lastSeen: Date.now()
            });

            await db.updateAgent(agent.id, {
              status: 'online',
              os: msg.os,
              version: msg.version,
              lastSeenAt: new Date().toISOString()
            });

            if (Array.isArray(msg.printers)) {
              await db.upsertPrintersForAgent(agent.id, agent.shopId, msg.printers);
            }

            this.sendToSocket(ws, {
              type: 'ack',
              serverTime: Date.now(),
              config: {
                heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
                reprintPolicy: 'manual',
                printers: (await db.getPrintersByShopId(agent.shopId))
                  .filter((p) => p.agentId === agent.id)
                  .map((p) => ({ id: p.id, systemName: p.systemName }))
              }
            });

            await this.reconcileUnfinishedJobs(agent.shopId, msg);
            shopOwnerAlerts.agentBackOnline(agent.shopId);
            await this.dispatchPendingJobsForShop(agent.shopId);
            break;
          }

          case 'job.accepted': {
            const job = await db.getPrintJobById(msg.jobId);
            if (!job) return;
            if (job.status === 'pending') {
              await db.updatePrintJob(job.id, {
                status: 'dispatched',
                dispatchedAt: job.dispatchedAt ?? new Date().toISOString()
              });
            }
            break;
          }

          case 'job.progress': {
            const job = await db.getPrintJobById(msg.jobId);
            if (!job) return;
            if (msg.state === 'printing') {
              await db.updatePrintJob(job.id, { status: 'printing' });
              const item = await db.getOrderItemById(job.orderItemId);
              if (!item) return;
              const order = await db.getOrderById(item.orderId);
              if (!order) return;
              if (order.status === 'queued') {
                const moved = await db.transitionOrderStatus(order.id, 'printing', {
                  pagesPrinted: msg.pagesPrinted ?? 0
                });
                if (moved.success && moved.order) {
                  this.notifyOrderStatus(order.id, 'printing', {
                    pagesPrinted: msg.pagesPrinted ?? 0
                  });
                  await orderNotifier
                    .notifyOrderPrinting(moved.order)
                    .catch((err) => console.warn('[Gateway] printing notification failed:', err));
                }
              }
            }
            break;
          }

          case 'job.result': {
            await this.handleJobResult(msg);
            break;
          }

          case 'printer.status': {
            const updated = await db.updatePrinterStatus(msg.printerId, msg.status);
            if (updated && msg.status !== 'online' && msg.status !== 'busy') {
              await shopOwnerAlerts
                .alertPrinterIssue(updated.shopId, updated.displayName, msg.status)
                .catch(() => {});
            }
            break;
          }

          case 'pong': {
            if (currentAgentId) {
              const entry = this.connectedAgents.get(currentAgentId);
              if (entry) entry.lastSeen = Date.now();
            }
            break;
          }
        }
      } catch (err) {
        console.error('[Gateway] Failed to handle agent message:', err);
        this.sendToSocket(ws, {
          type: 'error',
          message: 'Server could not process the agent message'
        });
      }
    });

    ws.on('close', () => {
      if (!currentAgentId) return;
      const current = this.connectedAgents.get(currentAgentId);
      if (current && current.ws !== ws) return; // newer socket already replaced us
      this.connectedAgents.delete(currentAgentId);
      void this.markAgentOffline(currentAgentId);
    });

    ws.on('error', (err) => {
      console.error('[Gateway] Agent WebSocket error:', err.message);
    });
  }

  private sendToSocket(ws: WebSocket, message: CloudToAgentMessage): void {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      console.warn('[Gateway] Could not send to agent:', err);
    }
  }

  private async markAgentOffline(agentId: string): Promise<void> {
    const agent = await db.getAgentById(agentId);
    if (!agent) return;
    await db.updateAgent(agentId, { status: 'offline' });
    const printers = await db.getPrintersByShopId(agent.shopId);
    for (const printer of printers) {
      if (printer.agentId === agentId && printer.status === 'online') {
        await db.updatePrinterStatus(printer.id, 'offline');
      }
    }
    await shopOwnerAlerts.alertAgentOffline(agent.shopId).catch(() => {});
  }

  private async heartbeatScan(): Promise<void> {
    const now = Date.now();
    const timeout = loadConfig().printerHeartbeatTimeoutMs;

    for (const [agentId, agent] of this.connectedAgents.entries()) {
      if (agent.ws.readyState !== 1 || now - agent.lastSeen > timeout) {
        this.connectedAgents.delete(agentId);
        try {
          agent.ws.close(4002, 'Heartbeat timeout');
        } catch {
          // ignore
        }
        await this.markAgentOffline(agentId);
        continue;
      }
      this.sendToSocket(agent.ws, { type: 'ping', timestamp: now });
    }
  }

  isShopAgentOnline(shopId: string): boolean {
    const timeout = loadConfig().printerHeartbeatTimeoutMs;
    const now = Date.now();
    for (const agent of this.connectedAgents.values()) {
      if (
        agent.shopId === shopId &&
        agent.ws.readyState === 1 &&
        now - agent.lastSeen <= timeout
      ) {
        return true;
      }
    }
    return false;
  }

  hasOnlinePrinter(shopId: string): boolean {
    return false; // replaced by the async helper below
  }

  async shopCanAcceptOrders(shopId: string): Promise<boolean> {
    if (!this.isShopAgentOnline(shopId)) return false;
    const printers = await db.getPrintersByShopId(shopId);
    return printers.some((p) => p.status === 'online');
  }

  private findConnection(shopId: string): ConnectedAgent | undefined {
    const now = Date.now();
    const timeout = loadConfig().printerHeartbeatTimeoutMs;
    return Array.from(this.connectedAgents.values()).find(
      (a) => a.shopId === shopId && a.ws.readyState === 1 && now - a.lastSeen <= timeout
    );
  }

  /**
   * Reconciles what the agent reports after a reconnect. A job the agent says
   * was spooling/printing is assumed printed to avoid a duplicate copy; jobs
   * that never reached the printer go back to the pending queue.
   */
  private async reconcileUnfinishedJobs(
    shopId: string,
    msg: Extract<AgentToCloudMessage, { type: 'hello' }>
  ): Promise<void> {
    const reported = new Map<string, UnfinishedJob['state']>();
    for (const job of msg.unfinishedJobs ?? []) reported.set(job.jobId, job.state);
    for (const jobId of msg.unfinishedJobIds ?? []) {
      if (!reported.has(jobId)) reported.set(jobId, 'unknown');
    }

    const jobs = await db.getPendingPrintJobsForShop(shopId);
    for (const { job, order } of jobs) {
      const state = reported.get(job.id);
      if (state === 'printing' || state === 'spooling') {
        // The paper may already be in the tray. Never reprint automatically.
        await db.updatePrintJob(job.id, {
          status: 'done',
          finishedAt: new Date().toISOString(),
          lastError: 'reconciled_after_reconnect_assumed_printed'
        });
        if (order.status === 'queued' || order.status === 'printing') {
          if (order.status === 'queued') {
            await db.transitionOrderStatus(order.id, 'printing', { reconciled: true });
          }
          const completed = await db.transitionOrderStatus(order.id, 'completed', {
            reconciled: true
          });
          if (completed.success) {
            this.notifyOrderStatus(order.id, 'completed', { token: order.token });
            const ended = await db.getOrderById(order.id);
            if (ended) await orderNotifier.notifyOrderCompleted(ended).catch(() => {});
          }
        }
        await db.logEvent(order.id, shopId, 'job.reconciled', {
          jobId: job.id,
          assumedPrinted: true
        });
      } else if (job.status === 'dispatched') {
        await db.updatePrintJob(job.id, {
          status: 'pending',
          lastError: 'reconnect_redispatch'
        });
      }
    }
  }

  /** Dispatches every pending job for a shop to its connected agent. */
  async dispatchPendingJobsForShop(shopId: string): Promise<number> {
    const connected = this.findConnection(shopId);
    if (!connected) return 0;

    const pending = await db.getPendingPrintJobsForShop(shopId);
    const printers = await db.getPrintersByShopId(shopId);
    const agentPrinters = printers.filter((p) => p.agentId === connected.agentId);
    const printer =
      agentPrinters.find((p) => p.status === 'online') ??
      agentPrinters[0] ??
      printers.find((p) => p.status === 'online');
    if (!printer) return 0;

    let dispatched = 0;
    for (const { job, item, file, order } of pending) {
      if (job.status !== 'pending') continue;
      if (file.deletedAt) {
        await this.failJob(job, order, 'file_deleted_before_print');
        continue;
      }

      const fileUrl = storage.signedFileUrl(
        this.serverBaseUrl,
        file.id,
        loadConfig().fileUrlTtlSeconds
      );
      const message: CloudToAgentMessage = {
        type: 'job.dispatch',
        jobId: job.id,
        fileUrl,
        sha256: file.sha256,
        settings: item.settings,
        printerSystemName: printer.systemName,
        documentName: file.originalName,
        pageCount: file.pageCount
      };
      this.sendToSocket(connected.ws, message);
      await db.updatePrintJob(job.id, {
        status: 'dispatched',
        printerId: printer.id,
        dispatchedAt: new Date().toISOString()
      });
      await db.updateOrderItem(item.id, { printerId: printer.id });
      dispatched++;
    }
    return dispatched;
  }

  private async handleJobResult(
    msg: Extract<AgentToCloudMessage, { type: 'job.result' }>
  ): Promise<void> {
    const job = await db.getPrintJobById(msg.jobId);
    if (!job) return;
    const item = await db.getOrderItemById(job.orderItemId);
    if (!item) return;
    const order = await db.getOrderById(item.orderId);
    if (!order) return;

    if (msg.ok) {
      if (job.status === 'done') return;
      await db.updatePrintJob(job.id, {
        status: 'done',
        finishedAt: new Date().toISOString(),
        lastError: null
      });

      if (order.status === 'queued') {
        const printing = await db.transitionOrderStatus(order.id, 'printing', {
          pagesPrinted: msg.pagesPrinted
        });
        if (printing.success) this.notifyOrderStatus(order.id, 'printing', {});
      }
      if (order.status === 'queued' || order.status === 'printing') {
        const completed = await db.transitionOrderStatus(order.id, 'completed', {
          pagesPrinted: msg.pagesPrinted
        });
        if (completed.success) {
          this.notifyOrderStatus(order.id, 'completed', {
            pagesPrinted: msg.pagesPrinted,
            token: order.token
          });
          const ended = await db.getOrderById(order.id);
          if (ended) await orderNotifier.notifyOrderCompleted(ended).catch(() => {});
        }
      }

      // Privacy: the printed file is deleted 15 minutes after completion. The
      // deadline is persisted, so an API restart cannot lose it.
      await storage.scheduleFileDeletion(item.fileId, 15);
      return;
    }

    await db.updatePrintJob(job.id, {
      status: 'failed',
      lastError: msg.error || 'Unknown print error',
      attempts: job.attempts + 1,
      finishedAt: new Date().toISOString()
    });

    const isHashMismatch = (msg.error || '').toLowerCase().includes('hash');
    if (!isHashMismatch && job.attempts + 1 < 3) {
      await db.updatePrintJob(job.id, { status: 'pending', lastError: msg.error || null });
      await this.dispatchPendingJobsForShop(order.shopId);
      return;
    }

    await this.failJob(job, order, msg.error || 'print_failed');
  }

  private async failJob(
    job: PrintJobRecord,
    order: OrderRecord,
    reason: string
  ): Promise<void> {
    await db.updatePrintJob(job.id, {
      status: 'failed',
      lastError: reason,
      finishedAt: new Date().toISOString()
    });

    if (order.status === 'queued' || order.status === 'printing' || order.status === 'paid') {
      const failed = await db.transitionOrderStatus(order.id, 'failed', { reason });
      if (failed.success) {
        this.notifyOrderStatus(order.id, 'failed', { reason });
        const failedOrder = failed.order ?? order;
        await orderNotifier.notifyOrderFailed(failedOrder).catch(() => {});
        const { paymentService } = await import('./payments.js');
        await paymentService.refundOrder(order.id, reason).catch(() => {});
      }
    }
    await shopOwnerAlerts.alertOrderFailed(order.shopId, order.token, reason).catch(() => {});
  }
}

export const gateway = new WebSocketGateway();
