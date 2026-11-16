import { db } from '@chhaap/db';
import { gateway } from './websocket-gateway.js';
import { orderNotifier } from './whatsapp/notifier.js';
import { conversationManager } from './whatsapp/conversation.js';
import { shopOwnerAlerts } from './whatsapp/owner-alerts.js';
import { paymentService } from './payments.js';
import { loadConfig } from './config.js';

export class ReconciliationCron {
  private timer: NodeJS.Timeout | null = null;

  start(intervalMs = 5 * 60 * 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runReconciliation();
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    shopOwnerAlerts.clearTimers();
  }

  async runReconciliation(now = new Date()): Promise<{
    expiredOrders: number;
    reattemptedJobs: number;
    failedJobs: number;
    expiredSessions: number;
  }> {
    let expiredOrders = 0;
    let reattemptedJobs = 0;
    let failedJobs = 0;
    let expiredSessions = 0;

    const config = loadConfig();

    try {
      // 1. Expire unpaid orders after the configured TTL.
      const cutoff = new Date(now.getTime() - config.orderExpiryMinutes * 60 * 1000);
      for (const order of await db.getOrdersAwaitingPaymentExpired(cutoff)) {
        const result = await db.transitionOrderStatus(order.id, 'expired', {
          reason: 'payment_ttl_expired'
        });
        if (result.success) {
          expiredOrders++;
          gateway.notifyOrderStatus(order.id, 'expired');
          await db.logEvent(order.id, order.shopId, 'order.expired', {
            reason: 'payment_ttl_expired'
          });
        }
      }

      // 2. Reconcile jobs whose agent stopped responding.
      const shops = await db.getAllShops();
      for (const shop of shops) {
        const jobs = await db.getPendingPrintJobsForShop(shop.id);
        const agentOnline = gateway.isShopAgentOnline(shop.id);

        for (const { job, order } of jobs) {
          if (job.status !== 'dispatched') continue;
          const dispatchedAt = job.dispatchedAt
            ? new Date(job.dispatchedAt).getTime()
            : new Date(job.createdAt).getTime();
          if (now.getTime() - dispatchedAt < 5 * 60 * 1000) continue;

          // The agent accepted the job but never reported a result. Do not
          // silently reprint: count an attempt and put it back in the queue.
          // The agent's persistent ledger prevents a duplicate copy if it did
          // in fact print before the crash.
          const attempts = job.attempts + 1;
          if (attempts >= 3) {
            await db.updatePrintJob(job.id, {
              status: 'failed',
              attempts,
              lastError: 'agent_result_timeout',
              finishedAt: now.toISOString()
            });
            if (['queued', 'printing', 'paid'].includes(order.status)) {
              const failed = await db.transitionOrderStatus(order.id, 'failed', {
                reason: 'agent_result_timeout'
              });
              if (failed.success) {
                gateway.notifyOrderStatus(order.id, 'failed', { reason: 'agent_result_timeout' });
                const fresh = (await db.getOrderById(order.id)) ?? order;
                await orderNotifier.notifyOrderFailed(fresh).catch(() => {});
                await paymentService.refundOrder(order.id, 'agent_result_timeout').catch(() => {});
              }
            }
            failedJobs++;
          } else {
            await db.updatePrintJob(job.id, {
              status: 'pending',
              attempts,
              lastError: agentOnline ? 'reconciliation_redispatch' : 'agent_offline'
            });
            reattemptedJobs++;
          }
        }

        if (agentOnline) {
          await gateway.dispatchPendingJobsForShop(shop.id).catch(() => {});
        }
      }

      // 3. WhatsApp session expiry and data minimisation.
      expiredSessions = await conversationManager.expireSessions(now).catch(() => 0);
      const waCutoff = new Date(
        now.getTime() - config.waMessageRetentionDays * 24 * 60 * 60 * 1000
      );
      await db.purgeOldWaMessages(waCutoff).catch(() => 0);

      // 4. Owner daily summary (if the shop configured a time).
      await shopOwnerAlerts.maybeSendDailySummary(now).catch(() => false);
    } catch (err) {
      console.error('[Reconciliation] Run failed:', err);
    }

    return { expiredOrders, reattemptedJobs, failedJobs, expiredSessions };
  }
}

export const reconciliationCron = new ReconciliationCron();
