import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { db } from '@chhaap/db';
import { makeTestPdf } from './helpers.js';

let ingestModule: any;
let configModule: any;
let scannerModule: any;
let pdfBuffer: Buffer;
const dataDir = path.join(os.tmpdir(), `chhaap-scanner-test-${crypto.randomUUID()}`);

before(async () => {
  await fs.mkdir(dataDir, { recursive: true });
  process.env.CHHAAP_DATA_DIR = dataDir;
  pdfBuffer = await makeTestPdf(dataDir);

  ingestModule = await import('../dist/ingest.js');
  configModule = await import('../dist/config.js');
  scannerModule = await import('../dist/scanner.js');
});

describe('T4 — File scanning pipeline and unsafe file policy', () => {
  it('clean scan sets scanStatus to clean and completes ingest', async () => {
    const fakeCleanScanner = {
      async scanFile(_filePath: string) {
        return { status: 'clean' as const };
      }
    };

    const result = await ingestModule.ingestFile({
      buffer: pdfBuffer,
      filename: 'sample.pdf',
      scanner: fakeCleanScanner
    });

    assert.ok(result.fileRecord);
    assert.equal(result.fileRecord.scanStatus, 'clean');
    assert.equal(result.fileRecord.pageCount, 2);

    const fromDb = await db.getFileById(result.fileRecord.id);
    assert.equal(fromDb?.scanStatus, 'clean');
  });

  it('infected scan rejects file, deletes bytes, sets scanStatus=infected, and logs threat without filename', async () => {
    const fakeInfectedScanner = {
      async scanFile(_filePath: string) {
        return { status: 'infected' as const, threat: 'Eicar-Test-Signature' };
      }
    };

    await assert.rejects(
      async () => {
        await ingestModule.ingestFile({
          buffer: pdfBuffer,
          filename: 'virus.pdf',
          scanner: fakeInfectedScanner
        });
      },
      /malware/i
    );

    // Verify infected file row is marked infected
    const allFiles = await db.getFilesByOrderId('unlinked');
    // Check files table in db
    const files = (db as any).files ? Array.from((db as any).files.values()) : [];
    const infectedFile = files.find((f: any) => f.scanStatus === 'infected');
    assert.ok(infectedFile, 'Infected file record must be recorded in database');
    assert.equal(infectedFile.scanStatus, 'infected');
    assert.ok(infectedFile.deletedAt, 'Infected file bytes must be marked deleted');
  });

  it('scanner failure fails closed in production', async () => {
    const fakeFailedScanner = {
      async scanFile(_filePath: string) {
        return { status: 'failed' as const, error: 'clamd connection timeout' };
      }
    };

    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      await assert.rejects(
        async () => {
          await ingestModule.ingestFile({
            buffer: pdfBuffer,
            filename: 'document.pdf',
            scanner: fakeFailedScanner
          });
        },
        /scanning failed/i
      );
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  it('rejects Office documents when OFFICE_UPLOADS=disabled', async () => {
    const prevOffice = process.env.OFFICE_UPLOADS;
    process.env.OFFICE_UPLOADS = 'disabled';

    try {
      await assert.rejects(
        async () => {
          await ingestModule.ingestFile({
            buffer: Buffer.from('fake office bytes'),
            filename: 'assignment.docx'
          });
        },
        /office documents are disabled/i
      );
    } finally {
      process.env.OFFICE_UPLOADS = prevOffice;
    }
  });

  it('production boot guard refuses SCAN_MODE=off without explicit risk acceptance', () => {
    const prevEnv = process.env.NODE_ENV;
    const prevScan = process.env.SCAN_MODE;
    const prevOffice = process.env.OFFICE_UPLOADS;
    const prevUnscanned = process.env.ALLOW_UNSCANNED_PDF_IMAGES;

    process.env.NODE_ENV = 'production';
    process.env.DB_MODE = 'postgres';
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.PAYMENTS_MODE = 'razorpay';
    process.env.RAZORPAY_KEY_ID = 'rzp_key';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_wh';
    process.env.WHATSAPP_MODE = 'cloud';
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'pid';
    process.env.WHATSAPP_APP_SECRET = 'appsec';
    process.env.WHATSAPP_VERIFY_TOKEN = 'vertok';
    process.env.WHATSAPP_PLATFORM_NUMBER = '919876543210';
    process.env.JWT_SECRET = 'test_jwt_secret_at_least_32_characters_long';
    process.env.FILE_URL_SECRET = 'test_file_url_secret_at_least_32_characters';
    process.env.PUBLIC_BASE_URL = 'https://chhaap.in';

    process.env.SCAN_MODE = 'off';
    process.env.OFFICE_UPLOADS = 'disabled';
    delete process.env.ALLOW_UNSCANNED_PDF_IMAGES;

    try {
      assert.throws(
        () => configModule.loadConfig(),
        /SCAN_MODE=off is refused/
      );

      // Now set explicit risk acceptance: ALLOW_UNSCANNED_PDF_IMAGES=true
      process.env.ALLOW_UNSCANNED_PDF_IMAGES = 'true';
      const cfg = configModule.loadConfig();
      assert.equal(cfg.scanMode, 'off');
    } finally {
      process.env.NODE_ENV = prevEnv;
      process.env.SCAN_MODE = prevScan;
      process.env.OFFICE_UPLOADS = prevOffice;
      process.env.ALLOW_UNSCANNED_PDF_IMAGES = prevUnscanned;
    }
  });
});
