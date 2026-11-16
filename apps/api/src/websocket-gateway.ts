import type { WebSocket } from 'ws';
import { db } from '@chhaap/db';
import type {
  AgentToCloudMessage,
  CloudToAgentMessage,
  OrderStatus
} from '@chhaap/shared';
import { storage } from './storage.js';

interface ConnectedAgent {
  agentId: string;
  shopId: string;
  ws: WebSocket;
  lastSeen: number;
}

export class WebSocketGateway {
  private connectedAgents = new Map<string, ConnectedAgent>();
  // SSE subscribers for orders: orderId -> Set of response writers
  private orderSubscribers = new Map<string, Set<(status: OrderStatus, data: Record<string, unknown>) => void>>();
  private serverBaseUrl: string = 'http://localhost:4000';

  setBaseUrl(url: string) {
    this.serverBaseUrl = url;
  }

  // --- SSE subscriptions for customer web clients ---
  subscribeOrder(
    orderId: string,
    callback: (status: OrderStatus, data: Record<string, unknown>) => void
  ): () => void {
    if (!this.orderSubscribers.has(orderId)) {
      this.orderSubscribers.set(orderId, new Set());
    }
    this.orderSubscribers.get(orderId)!.add(callback);

    return () => {
      const set = this.orderSubscribers.get(orderId);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          this.orderSubscribers.delete(orderId);
        }
      }
    };
  }

  notifyOrderStatus(orderId: string, status: OrderStatus, data: Record<string, unknown> = {}) {
    const subscribers = this.orderSubscribers.get(orderId);
    if (subscribers) {
      for (const cb of subscribers) {
        try {
          cb(status, data);
        } catch (err) {
          console.error('[Gateway] Failed to notify SSE subscriber:', err);
        }
      }
    }
  }

  // --- Agent WebSocket connection handler ---
  handleAgentConnection(ws: WebSocket) {
    let currentAgentId: string | null = null;
    let currentShopId: string | null = null;

    ws.on('message', async (data: Buffer | string) => {
      try {
        const msg: AgentToCloudMessage = JSON.parse(data.toString());

        if (msg.type === 'hello') {
          const agent = db.getAgentByToken(msg.token);
          if (!agent || agent.id !== msg.agentId) {
            const errReply: CloudToAgentMessage = {
              type: 'error',
              message: 'Authentication failed: Invalid agent ID or token'
            };
            ws.send(JSON.stringify(errReply));
            ws.close(4001, 'Unauthorized');
            return;
          }

          currentAgentId = agent.id;
          currentShopId = agent.shopId;

          // Register connection
          this.connectedAgents.set(agent.id, {
            agentId: agent.id,
            shopId: agent.shopId,
            ws,
            lastSeen: Date.now()
          });

          // Update agent in DB
          db.updateAgent(agent.id, {
            status: 'online',
            os: msg.os,
            version: msg.version,
            lastSeenAt: new Date().toISOString()
          });

          // Upsert discovered printers from agent
          if (msg.printers && Array.isArray(msg.printers)) {
            db.upsertPrintersForAgent(agent.id, agent.shopId, msg.printers);
          }

          const ack: CloudToAgentMessage = {
            type: 'ack',
            serverTime: Date.now(),
            config: {
              heartbeatIntervalMs: 20000
            }
          };
          ws.send(JSON.stringify(ack));
          console.log(`[Gateway] Agent ${agent.id} authenticated for shop ${agent.shopId}`);

          // Reconcile and dispatch any pending queued jobs
          await this.dispatchPendingJobsForShop(agent.shopId);
        } else if (msg.type === 'job.accepted') {
          const job = db.getPrintJobById(msg.jobId);
          if (job) {
            db.updatePrintJob(job.id, { status: 'dispatched', dispatchedAt: new Date().toISOString() });
          }
        } else if (msg.type === 'job.progress') {
          const job = db.getPrintJobById(msg.jobId);
          if (job) {
            if (msg.state === 'printing') {
              db.updatePrintJob(job.id, { status: 'printing' });
              const item = db.orderItems.get(job.orderItemId);
              if (item) {
                db.transitionOrderStatus(item.orderId, 'printing', {
                  pagesPrinted: msg.pagesPrinted
                });
                this.notifyOrderStatus(item.orderId, 'printing', {
                  pagesPrinted: msg.pagesPrinted
                });
              }
            }
          }
        } else if (msg.type === 'job.result') {
          const job = db.getPrintJobById(msg.jobId);
          if (job) {
            if (msg.ok) {
              db.updatePrintJob(job.id, {
                status: 'done',
                finishedAt: new Date().toISOString()
              });

              const item = db.orderItems.get(job.orderItemId);
              if (item) {
                db.transitionOrderStatus(item.orderId, 'completed', {
                  pagesPrinted: msg.pagesPrinted
                });
                this.notifyOrderStatus(item.orderId, 'completed', {
                  pagesPrinted: msg.pagesPrinted,
                  token: db.getOrderById(item.orderId)?.token
                });

                // Auto-delete file after 15 min for privacy guarantee
                storage.scheduleFileDeletion(item.fileId, 15 * 60 * 1000);
              }
              console.log(`[Gateway] Job ${job.id} completed successfully (${msg.pagesPrinted} pages)`);
            } else {
              db.updatePrintJob(job.id, {
                status: 'failed',
                lastError: msg.error || 'Unknown print error',
                attempts: job.attempts + 1
              });

              const item = db.orderItems.get(job.orderItemId);
              if (item) {
                if (job.attempts < 3) {
                  console.warn(`[Gateway] Job ${job.id} failed, retry attempt ${job.attempts + 1}/3`);
                  // Retry dispatch
                  if (currentShopId) {
                    await this.dispatchPendingJobsForShop(currentShopId);
                  }
                } else {
                  db.transitionOrderStatus(item.orderId, 'failed', { error: msg.error });
                  this.notifyOrderStatus(item.orderId, 'failed', { error: msg.error });
                }
              }
            }
          }
        } else if (msg.type === 'printer.status') {
          db.updatePrinterStatus(msg.printerId, msg.status);
        } else if (msg.type === 'pong') {
          if (currentAgentId) {
            const entry = this.connectedAgents.get(currentAgentId);
            if (entry) entry.lastSeen = Date.now();
          }
        }
      } catch (err) {
        console.error('[Gateway] Failed to handle agent message:', err);
      }
    });

    ws.on('close', () => {
      if (currentAgentId) {
        this.connectedAgents.delete(currentAgentId);
        db.updateAgent(currentAgentId, { status: 'offline' });
        console.log(`[Gateway] Agent ${currentAgentId} disconnected`);
      }
    });

    ws.on('error', (err: any) => {
      console.error('[Gateway] Agent WS error:', err);
    });
  }

  isShopAgentOnline(shopId: string): boolean {
    for (const agent of this.connectedAgents.values()) {
      if (agent.shopId === shopId && agent.ws.readyState === 1 /* OPEN */) {
        return true;
      }
    }
    return false;
  }

  /**
   * Dispatches any pending print jobs for a shop to the shop's connected agent
   */
  async dispatchPendingJobsForShop(shopId: string): Promise<number> {
    const connected = Array.from(this.connectedAgents.values()).find(
      (a) => a.shopId === shopId && a.ws.readyState === 1
    );

    if (!connected) {
      console.log(`[Gateway] No online agent for shop ${shopId} to dispatch pending jobs`);
      return 0;
    }

    const pending = db.getPendingPrintJobsForShop(shopId);
    let dispatchedCount = 0;

    for (const { job, item, file, order } of pending) {
      if (job.status !== 'pending') continue;

      // Find suitable printer
      const printers = db.getPrintersByShopId(shopId);
      const printer = printers.find((p) => p.status === 'online') || printers[0];
      const printerSystemName = printer ? printer.systemName : 'PDF';

      const fileUrl = `${this.serverBaseUrl}/v1/files/${file.id}/download`;

      const dispatchMsg: CloudToAgentMessage = {
        type: 'job.dispatch',
        jobId: job.id,
        fileUrl,
        sha256: file.sha256,
        settings: item.settings,
        printerSystemName,
        documentName: file.originalName
      };

      connected.ws.send(JSON.stringify(dispatchMsg));
      db.updatePrintJob(job.id, {
        status: 'dispatched',
        printerId: printer?.id || null,
        dispatchedAt: new Date().toISOString()
      });
      dispatchedCount++;
      console.log(`[Gateway] Dispatched job ${job.id} for order ${order.id} (token ${order.token})`);
    }

    return dispatchedCount;
  }
}

export const gateway = new WebSocketGateway();
