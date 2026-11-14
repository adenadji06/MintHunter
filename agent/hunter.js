// hunter.js — finds new free-mint candidates on BSC.
// Strategy: start from a curated list of real free-mint contracts, then try
// to enrich it with a live fetch from MintRadar (https://datt.my). A failed
// live fetch never crashes the hunt; it degrades to the curated list.

const fs = require('fs');
const path = require('path');

const DEMO_CONTRACT_PATH = path.join(__dirname, 'demo-contract.json');

// The testnet demo contract, written by agent/deploy-demo.js after a
// successful deploy on BSC testnet (chain 97). Included as a clearly-marked
// testnet entry when the file exists; absent before the deploy has run.
function loadDemoContract() {
  try {
    const raw = fs.readFileSync(DEMO_CONTRACT_PATH, 'utf8');
    const demo = JSON.parse(raw);
    if (demo && /^0x[0-9a-fA-F]{40}$/.test(demo.contract)) {
      return {
        contract: demo.contract,
        name: demo.name || 'MintHunter Demo (testnet)',
        chainId: 97,
        source: 'testnet-demo',
      };
    }
  } catch {
    // No deployed demo contract yet — the normal state before deploy-demo.js
    // has run.
  }
  return null;
}

const CURATED = [
  {
    contract: '0x7bcc29c5405286b4dd8b5b23fe7097f9ee65e4e5',
    name: 'Agentic (AGTC)',
    chainId: 56,
    source: 'curated',
  },
  {
    contract: '0xc5624b61bee1971e6aa3ab5f403236ab32c2b6cd',
    name: 'TIME CARDS',
    chainId: 56,
    source: 'curated',
  },
  {
    contract: '0xf9D00B7a2992de00EBc5F9f04BAf95d44C542102',
    name: 'Pocket Ai NFT',
    chainId: 56,
    source: 'curated',
  },
  // Test candidate: a wallet drained in Nov 2026 through an EIP-7702
  // phishing delegation. The verifier must flag it UNSAFE, never mint it.
  {
    contract: '0xd24afeCEF683BB9E35d78e91ed4198bA9E59a233',
    name: 'Drained wallet (EIP-7702 phishing test)',
    chainId: 56,
    source: 'curated-test',
  },
];

const MINT_RADAR_URL = 'https://datt.my/';
const FETCH_TIMEOUT_MS = 8000;
const MAX_LIVE_LEADS = 5;

// Extract EVM addresses from a block of HTML/text.
function extractAddresses(text) {
  const found = text.match(/0x[0-9a-fA-F]{40}/g) || [];
  const seen = new Set();
  const out = [];
  for (const addr of found) {
    const lower = addr.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      out.push(addr);
    }
  }
  return out;
}

// Try to pull fresh leads from MintRadar's front page. Returns [] on any
// failure so the caller can fall back to the curated list.
async function fetchMintRadarLeads() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(MINT_RADAR_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 MintHunter/1.0 (NEAR Hackathon demo)' },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.log(`[hunter] MintRadar fetch returned HTTP ${res.status}, ignoring live leads.`);
      return [];
    }
    const html = await res.text();
    const known = new Set(CURATED.map((c) => c.contract.toLowerCase()));
    const leads = extractAddresses(html)
      .filter((a) => !known.has(a.toLowerCase()))
      .slice(0, MAX_LIVE_LEADS)
      .map((address, i) => ({
        contract: address,
        name: `MintRadar lead ${i + 1}`,
        chainId: 56,
        source: 'mintradar',
      }));
    console.log(`[hunter] MintRadar returned ${leads.length} new lead(s).`);
    return leads;
  } catch (err) {
    console.log(`[hunter] MintRadar fetch failed (${err.message}), using curated list only.`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Find free-mint candidates. Always returns at least the curated list.
async function hunt() {
  const live = await fetchMintRadarLeads();
  const demo = loadDemoContract();
  const candidates = [...CURATED, ...(demo ? [demo] : []), ...live];
  console.log(
    `[hunter] Found ${candidates.length} candidate(s) (${CURATED.length} curated, ${demo ? 1 : 0} testnet demo, ${live.length} live).`,
  );
  return candidates;
}

module.exports = { hunt, CURATED, loadDemoContract };
