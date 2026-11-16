# Chhaap — Operational Runbook & Developer Guide

## Quick Start (Walking Skeleton)

### 1. Build All Packages
\`\`\`bash
pnpm -r run build
\`\`\`

### 2. Run Tests
\`\`\`bash
pnpm --filter @chhaap/pricing test
pnpm --filter @chhaap/api test
\`\`\`

### 3. Start the API Server & Web UI
\`\`\`bash
pnpm dev:api
# Or: node apps/api/dist/index.js
\`\`\`
- Landing Page: `http://localhost:4000/`
- Customer PWA (Scan simulation): `http://localhost:4000/s/campus-xerox`
- Shop Owner Dashboard: `http://localhost:4000/shop/campus-xerox`

### 4. Start the Print Agent (on Shop PC)
\`\`\`bash
pnpm dev:agent
# Or: node apps/agent/dist/index.js
\`\`\`
- Connects outbound to `ws://localhost:4000/v1/agent/connect`
- Handshakes and exposes CUPS / Virtual PDF printer
- Spools printed files to `./test-prints/`
- Automatically deletes temporary download files after spooling for provable privacy!

---

## Architectural Principles & Invariants

1. **Outbound-only WebSocket**: Shop PCs connect out to the cloud. No port forwarding, no static IP.
2. **Pay-Before-Print Invariant**: Jobs are queued and dispatched only upon verified payment webhook or test payment.
3. **Paise Integers for All Money**: All rates, fees, taxes, and subtotals are stored and calculated as integer paise.
4. **Exact Billing**: Per-page colour coverage detection via Ghostscript \`inkcov\` prevents shop revenue leakage.
5. **Provable Privacy**: Uploaded files are deleted from the agent immediately after spooling, and from cloud storage within 15 minutes of completion.
