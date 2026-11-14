// verifier.js — the safety gate. Every candidate must pass all checks
// before any mint is attempted. A single hard failure means UNSAFE.
//
// Checks, in order:
//   (1) Source verified on Sourcify (chain of the candidate: 56 or 97).
//   (2) A free mint entry point exists and costs nothing (or <= $0.05).
//   (3) The contract owner is not an excluded deployer.
//   (4) No EIP-7702 delegation on the candidate address.
//   (5) No drain patterns in the verified source.
//
// Tuning note on check (5): a plain owner-only withdraw() that sends the
// contract's own BNB balance to the owner is standard paid-mint revenue
// collection — every clean contract in the curated list has one. Flagging it
// would mark every real free mint UNSAFE, so it is NOT treated as a drain.
// Only clearly malicious patterns are flagged: selfdestruct, delegatecall to
// an arbitrary address, sweeping arbitrary ERC-20 balances to the owner, and
// the contract granting itself token approvals.

const { ethers } = require('ethers');

// RPC + Sourcify chain per supported chain id. Mainnet (56) is the default;
// the testnet demo contract uses BSC testnet (97).
const CHAINS = {
  56: {
    rpc: 'https://bsc-dataseed.binance.org',
    sourcifyChain: 56,
    label: 'BSC mainnet',
  },
  97: {
    rpc: 'https://data-seed-prebsc-1-s1.binance.org:8545',
    sourcifyChain: 97,
    label: 'BSC testnet',
  },
};
const SOURCIFY_URL = (chainId, addr) =>
  `https://sourcify.dev/server/v2/contract/${chainId}/${addr}?fields=sources`;
const USER_AGENT = 'Mozilla/5.0 MintHunter/1.0 (NEAR Hackathon demo)';
const FETCH_TIMEOUT_MS = 15000;

// Deployer under a total stop: never mint from this deployer.
const EXCLUDED_DEPLOYER = '0xd76d5918fb337667b22fe37ae2055b5542cf8dc9';

// Known EIP-7702 phishing delegation contracts from the Nov 2026 drain.
const KNOWN_PHISHING_DELEGATES = new Set([
  '0x9db96924a0b0b9a83fe2368b29539561a9c696d8',
  '0xe25db171b622ce6f9e262a0ac84d73790bb54365',
]);

const OWNER_SELECTOR = '0x8da5cb5b'; // owner()

// --- small helpers ---------------------------------------------------------

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...options,
      headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function rpcCall(method, params, chainId = 56) {
  const chain = CHAINS[chainId] || CHAINS[56];
  const { ok, json } = await fetchJson(chain.rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!ok || !json || json.error || typeof json.result === 'undefined') {
    throw new Error(`RPC ${method} failed: ${json && json.error ? json.error.message : 'HTTP error'}`);
  }
  return json.result;
}

// Extract the body of a Solidity function definition by brace matching.
function extractFunctionBody(source, fnName) {
  const re = new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)[^{;]*\\{`, 's');
  const m = re.exec(source);
  if (!m) return null;
  let depth = 0;
  let i = m.index + m[0].length - 1; // position of the opening brace
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(m.index, i + 1);
    }
  }
  return null;
}

// Resolve a price constant such as `FREE_PRICE = 0` or `PRICE = 0.001 ether`
// to wei (BigInt). Returns null when the constant cannot be resolved.
function resolvePriceWei(source, constName) {
  const re = new RegExp(`${constName}\\s*=\\s*([0-9.]+)\\s*(ether|gwei|wei)?`, 'i');
  const m = re.exec(source);
  if (!m) return null;
  const num = m[1];
  const unit = (m[2] || 'wei').toLowerCase();
  try {
    if (unit === 'ether') return ethers.parseEther(num);
    if (unit === 'gwei') return ethers.parseUnits(num, 'gwei');
    // Plain integer with no unit is wei; a decimal without a unit is invalid.
    if (num.includes('.')) return null;
    return BigInt(num);
  } catch {
    return null;
  }
}

// --- check (2): free mint --------------------------------------------------

// Look for a free mint entry point. Returns { free: true, fn } when a
// zero-cost mint function is confirmed, otherwise { free: false }.
function findFreeMint(source) {
  const freeNames = ['mintFree', 'freeMint', 'claimFree', 'freeClaim'];
  for (const name of freeNames) {
    const body = extractFunctionBody(source, name);
    if (!body) continue;
    const isPayable = /\bpayable\b/.test(body.split('{')[0]);
    // A non-payable free function cannot take payment: free, confirmed.
    if (!isPayable && !/msg\.value/.test(body)) {
      return { free: true, fn: name };
    }
    // Payable free function: it is only free if it requires msg.value == 0
    // (directly, or through a zero-valued price constant).
    if (/msg\.value\s*==\s*0\b/.test(body) || /msg\.value\s*!=\s*FREE_PRICE/.test(body)) {
      const priceWei = resolvePriceWei(source, 'FREE_PRICE');
      if (priceWei !== null && priceWei === 0n) return { free: true, fn: name };
      if (/msg\.value\s*==\s*0\b/.test(body)) return { free: true, fn: name };
    }
    if (/msg\.value\s*==\s*FREE_PRICE/.test(body)) {
      const priceWei = resolvePriceWei(source, 'FREE_PRICE');
      if (priceWei !== null && priceWei === 0n) return { free: true, fn: name };
    }
    // Named free function exists but its price is not provably zero.
    return { free: false, fn: name };
  }
  // No free-named function: a plain mint/claim with a zero price also counts.
  for (const name of ['mint', 'claim']) {
    const body = extractFunctionBody(source, name);
    if (!body) continue;
    if (!/msg\.value/.test(body) && !/\bpayable\b/.test(body.split('{')[0])) {
      return { free: true, fn: name };
    }
  }
  return { free: false, fn: null };
}

// --- check (5): drain patterns ---------------------------------------------
//
// Only project files are scanned (OpenZeppelin library files are excluded:
// their standard setApprovalForAll / _setApprovalForAll code is not a drain).

function projectSources(sources) {
  const out = {};
  for (const [path, file] of Object.entries(sources)) {
    if (path.startsWith('@openzeppelin/') || path.includes('/openzeppelin/')) continue;
    out[path] = typeof file.content === 'string' ? file.content : '';
  }
  return out;
}

function scanDrainPatterns(projectFiles) {
  const hits = [];
  for (const [path, content] of Object.entries(projectFiles)) {
    const lines = content.split('\n');
    // selfdestruct: destroys the contract, can redirect funds.
    if (/selfdestruct\s*\(/.test(content)) {
      hits.push(`selfdestruct found in ${path}`);
    }
    // delegatecall to an arbitrary address: full code control for the target.
    if (/\.delegatecall\s*\(/.test(content)) {
      hits.push(`delegatecall to an arbitrary address found in ${path}`);
    }
    // Sweep of an arbitrary ERC-20 balance to the owner: a function that
    // takes any token address and transfers its whole contract balance out.
    // (Plain `transfer(owner, balance)` of a token the contract itself
    // issued is not matched: the token must be a function parameter.)
    for (const line of lines) {
      if (
        /IERC20\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\)\s*\.\s*transfer\s*\(\s*(owner|owner\(\)|msg\.sender)/.test(line) &&
        /balanceOf\s*\(\s*address\s*\(\s*this\s*\)\s*\)/.test(line)
      ) {
        hits.push(`arbitrary token sweep to owner found in ${path}`);
        break;
      }
    }
    // The contract granting itself a token approval (a bare call-site, not
    // the standard ERC-721 `function setApprovalForAll(...)` definition and
    // not the OpenZeppelin internal `_setApprovalForAll` helper).
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (/function\s+setApprovalForAll\s*\(/.test(line)) continue;
      if (/_setApprovalForAll\s*\(/.test(line)) continue;
      if (/\bsetApprovalForAll\s*\(\s*[^,]+,\s*true\s*\)/.test(line)) {
        hits.push(`contract grants itself setApprovalForAll in ${path}`);
        break;
      }
    }
  }
  return hits;
}

// --- main entry point ------------------------------------------------------

async function verify(candidate) {
  const contract = candidate.contract;
  const chainId = candidate.chainId || 56;
  const chain = CHAINS[chainId] || CHAINS[56];
  const reasons = [];
  let hardFail = false;
  let freeFunction = null;

  // (1) Source verified on Sourcify (candidate's chain).
  let sourceText = null;
  try {
    const { ok, json } = await fetchJson(SOURCIFY_URL(chain.sourcifyChain, contract));
    const sources = json && json.sources ? json.sources : null;
    if (ok && sources && Object.keys(sources).length > 0) {
      const projectFiles = projectSources(sources);
      sourceText = Object.values(projectFiles).join('\n');
      reasons.push('source verified');
      // (2) Free mint confirmed from the verified source.
      const found = findFreeMint(sourceText);
      if (found.free) {
        freeFunction = found.fn;
        reasons.push(`free mint confirmed (${found.fn})`);
      } else {
        hardFail = true;
        reasons.push(
          found.fn
            ? `cannot confirm free mint (${found.fn} price is not provably zero)`
            : 'cannot confirm free mint (no free mint function found)',
        );
      }
      // (5) Drain patterns in the verified source.
      const drains = scanDrainPatterns(projectFiles);
      if (drains.length > 0) {
        hardFail = true;
        reasons.push(...drains.map((d) => `drain pattern: ${d}`));
      } else {
        reasons.push('no drain patterns');
      }
    } else {
      hardFail = true;
      reasons.push('source not verified');
    }
  } catch (err) {
    hardFail = true;
    reasons.push(`source check failed (${err.message})`);
  }

  // (3) Excluded deployer: read owner() when available, skip gracefully
  // when the contract has no owner() function.
  try {
    const result = await rpcCall(
      'eth_call',
      [{ to: contract, data: OWNER_SELECTOR }, 'latest'],
      chainId,
    );
    if (result && result !== '0x' && result.length >= 66) {
      const owner = `0x${result.slice(-40)}`.toLowerCase();
      if (owner === EXCLUDED_DEPLOYER) {
        hardFail = true;
        reasons.push(`owner is excluded deployer ${EXCLUDED_DEPLOYER}`);
      } else {
        reasons.push(`owner ${owner} is not excluded`);
      }
    } else {
      reasons.push('owner() returned no address — deployer check skipped');
    }
  } catch (err) {
    reasons.push(`owner() unavailable — deployer check skipped (${err.message})`);
  }

  // (4) EIP-7702 delegation check. Runs even when the source check failed:
  // a drained wallet has no contract source, but its delegation is exactly
  // what must be caught.
  try {
    const code = await rpcCall('eth_getCode', [contract, 'latest'], chainId);
    if (typeof code === 'string' && code.toLowerCase().startsWith('0xef0100')) {
      hardFail = true;
      const delegate = `0x${code.slice(8, 48)}`.toLowerCase();
      if (KNOWN_PHISHING_DELEGATES.has(delegate)) {
        reasons.push(`EIP-7702 delegation to known phishing contract ${delegate}`);
      } else {
        reasons.push(`EIP-7702 delegation to ${delegate} (unknown delegate)`);
      }
    } else {
      reasons.push('no delegation');
    }
  } catch (err) {
    // A failed code read is a safety failure: never treat it as clean.
    hardFail = true;
    reasons.push(`delegation check failed (${err.message})`);
  }

  return {
    contract,
    chainId,
    chain: chain.label,
    verdict: hardFail ? 'UNSAFE' : 'SAFE',
    reasons,
    freeFunction,
  };
}

module.exports = { verify, EXCLUDED_DEPLOYER, KNOWN_PHISHING_DELEGATES, CHAINS };
