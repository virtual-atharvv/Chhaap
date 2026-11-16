import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { buildServer } from '../dist/server.js';
import { db } from '@chhaap/db';

describe('Phase 1 Walking Skeleton — End-to-End Test', () => {
  let app;
  let serverPort;
  let testPdfPath;

  before(async () => {
    // Generate a minimal valid test PDF with Ghostscript
    testPdfPath = path.join(process.cwd(), 'data', 'test-sample.pdf');
    await fs.mkdir(path.dirname(testPdfPath), { recursive: true });

    await new Promise((resolve, reject) => {
      const gs = spawn('gs', [
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        '-dNOPAUSE',
        '-dQUIET',
        '-dBATCH',
        `-sOutputFile=${testPdfPath}`,
        '-c',
        'showpage'
      ]);
      gs.on('close', (code) => (code === 0 ? resolve(true) : reject(new Error('GS failed'))));
    });

    // Start API server on random port
    app = await buildServer();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const url = new URL(address);
    serverPort = parseInt(url.port, 10);
  });

  after(async () => {
    await app.close();
    await fs.unlink(testPdfPath).catch(() => {});
    process.exit(0);
  });

  it('completes the full loop: QR Scan -> Upload -> Quote -> Pay -> Agent WS -> Virtual Print -> Done', async () => {
    const baseUrl = `http://127.0.0.1:${serverPort}`;
    const wsUrl = `ws://127.0.0.1:${serverPort}/v1/agent/connect`;

    // ------------------------------------------------------------------------
    // Step 1: Connect Mock Print Agent via Outbound WebSocket
    // ------------------------------------------------------------------------
    const agentWs = new WebSocket(wsUrl);
    let agentAckReceived = false;
    let jobDispatchReceived = null;

    const agentConnectedPromise = new Promise((resolve, reject) => {
      agentWs.on('open', () => {
        // Send hello handshake
        agentWs.send(
          JSON.stringify({
            type: 'hello',
            agentId: 'agent-campus-1',
            token: 'test_agent_secret_token_123',
            version: '0.1.0',
            os: 'linux',
            printers: [
              {
                systemName: 'PDF',
                displayName: 'Virtual CUPS-PDF',
                color: true,
                duplex: true,
                papers: ['A4', 'A3']
              }
            ]
          })
        );
      });

      agentWs.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ack') {
          agentAckReceived = true;
          resolve(true);
        } else if (msg.type === 'job.dispatch') {
          jobDispatchReceived = msg;
        }
      });

      agentWs.on('error', reject);
    });

    await agentConnectedPromise;
    assert.equal(agentAckReceived, true, 'Agent should receive ack from Cloud Gateway');

    // ------------------------------------------------------------------------
    // Step 2: Customer Scans QR Code -> Check Shop Status
    // ------------------------------------------------------------------------
    const shopRes = await fetch(`${baseUrl}/v1/shops/campus-xerox`);
    assert.equal(shopRes.status, 200);
    const shopData = await shopRes.json();
    assert.equal(shopData.shop.name, 'Campus Xerox & Stationary');
    assert.equal(shopData.shop.printerOnline, true, 'Printer should show online after agent connects');

    // ------------------------------------------------------------------------
    // Step 3: Customer Uploads Document
    // ------------------------------------------------------------------------
    const pdfBuffer = await fs.readFile(testPdfPath);
    const formData = new FormData();
    formData.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'test-sample.pdf');

    const uploadRes = await fetch(`${baseUrl}/v1/uploads`, {
      method: 'POST',
      body: formData
    });
    assert.equal(uploadRes.status, 200);
    const uploadData = await uploadRes.json();

    assert.ok(uploadData.fileId);
    assert.equal(uploadData.pageCount, 1);
    assert.equal(uploadData.originalName, 'test-sample.pdf');
    assert.ok(Array.isArray(uploadData.perPageClassification));

    // ------------------------------------------------------------------------
    // Step 4: Customer Creates Draft Order
    // ------------------------------------------------------------------------
    const orderRes = await fetch(`${baseUrl}/v1/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopSlug: 'campus-xerox',
        fileId: uploadData.fileId,
        pageCount: uploadData.pageCount,
        perPageClassification: uploadData.perPageClassification,
        settings: {
          copies: 1,
          paperSize: 'A4',
          colorMode: 'bw',
          sides: 'single'
        }
      })
    });

    assert.equal(orderRes.status, 200);
    const orderData = await orderRes.json();
    const orderId = orderData.order.id;
    const itemId = orderData.item.id;
    assert.ok(orderData.order.token.match(/^[A-Z]-\d{3}$/), 'Pickup token format like B-047');
    assert.equal(orderData.order.status, 'draft');

    // ------------------------------------------------------------------------
    // Step 5: Customer Updates Print Options (2 copies, duplex) -> Live Re-price
    // ------------------------------------------------------------------------
    const repriceRes = await fetch(`${baseUrl}/v1/orders/${orderId}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          copies: 2,
          paperSize: 'A4',
          colorMode: 'bw',
          sides: 'duplex',
          pagesPerSheet: 1,
          orientation: 'auto',
          fitMode: 'fit'
        },
        perPageClassification: uploadData.perPageClassification
      })
    });

    assert.equal(repriceRes.status, 200);
    const repriced = await repriceRes.json();
    assert.equal(repriced.item.settings.copies, 2);
    assert.ok(repriced.order.totalPaise >= 500, 'Min order price enforced');

    // ------------------------------------------------------------------------
    // Step 6: Customer Pays (Simulated Payment) -> Triggers Dispatch
    // ------------------------------------------------------------------------
    const payRes = await fetch(`${baseUrl}/v1/orders/${orderId}/fake-pay`, {
      method: 'POST'
    });
    assert.equal(payRes.status, 200);

    // Wait briefly for WebSocket dispatch message to arrive at Agent
    let waitLoops = 0;
    while (!jobDispatchReceived && waitLoops < 20) {
      await new Promise((r) => setTimeout(r, 100));
      waitLoops++;
    }

    assert.ok(jobDispatchReceived, 'Agent should receive job.dispatch message');
    assert.equal(jobDispatchReceived.type, 'job.dispatch');
    assert.equal(jobDispatchReceived.settings.copies, 2);

    // ------------------------------------------------------------------------
    // Step 7: Agent Simulates Download, Verification, and Printing
    // ------------------------------------------------------------------------
    // Agent sends job.accepted
    agentWs.send(
      JSON.stringify({
        type: 'job.accepted',
        jobId: jobDispatchReceived.jobId
      })
    );

    // Agent downloads the file
    const fileRes = await fetch(jobDispatchReceived.fileUrl);
    assert.equal(fileRes.status, 200);
    const downloadedBuf = Buffer.from(await fileRes.arrayBuffer());

    // Agent verifies SHA256
    const hash = crypto.createHash('sha256').update(downloadedBuf).digest('hex');
    assert.equal(hash, jobDispatchReceived.sha256, 'Downloaded file SHA256 matches');

    // Agent sends progress: printing
    agentWs.send(
      JSON.stringify({
        type: 'job.progress',
        jobId: jobDispatchReceived.jobId,
        state: 'printing',
        pagesPrinted: 2
      })
    );

    // Agent sends result: ok
    agentWs.send(
      JSON.stringify({
        type: 'job.result',
        jobId: jobDispatchReceived.jobId,
        ok: true,
        pagesPrinted: 2
      })
    );

    // Wait for server to process result
    await new Promise((r) => setTimeout(r, 200));

    // ------------------------------------------------------------------------
    // Step 8: Verify Final Order State is 'completed'
    // ------------------------------------------------------------------------
    const finalOrderRes = await fetch(`${baseUrl}/v1/orders/${orderId}`);
    assert.equal(finalOrderRes.status, 200);
    const finalOrder = await finalOrderRes.json();
    assert.equal(finalOrder.order.status, 'completed', 'Order status should be completed');
    assert.ok(finalOrder.order.completedAt);

    agentWs.close();
  });
});
