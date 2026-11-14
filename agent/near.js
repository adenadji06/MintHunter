// near.js — NEAR identity and Intents quote helpers for MintHunter.
//
// MintHunter is an autonomous free-mint hunter agent built for the
// NEAR Hackathon 2026 (track: agents). The agent's identity is a NEAR
// testnet account. Its EVM address is derived from that NEAR account
// via NEAR chain signatures (MPC), and cross-chain execution is routed
// through NEAR Intents (1Click API).
//
// Testnet only. This module never spends funds, never signs anything,
// and never handles a real private key, seed phrase, or secret. The
// identity derivation below is a public view call (read-only).
//
// CommonJS, Node >= 18, near-api-js v5, ethers v6.

const nearAPI = require('near-api-js');
const { ethers } = require('ethers');

// ---------------------------------------------------------------------------
// Configuration (testnet only)
// ---------------------------------------------------------------------------

// Public NEAR testnet RPC endpoint.
const NEAR_RPC_URL = 'https://rpc.testnet.near.org';

// NEAR chain-signatures MPC contract on testnet.
const MPC_CONTRACT_ID = 'v1.signer-prod.testnet';

// Demo agent identity: a NEAR testnet account id. Deriving its EVM
// address only needs a public view call, so no key is required.
const AGENT_NEAR_ACCOUNT_ID = 'minthunter.testnet';

// Standard chain-signatures derivation path used for this demo.
const DERIVATION_PATH = 'near';

// NEAR Intents (1Click) quote endpoint.
const INTENTS_QUOTE_URL = 'https://1click.chaindefuser.com/v0/quote';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Minimal Base58 decoder (Bitcoin alphabet), implemented locally so this
// module needs no extra dependency. Used to decode the "secp256k1:<base58>"
// public key string returned by the MPC contract.
const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(input) {
  let value = 0n;
  for (const char of input) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) {
      throw new Error(`Invalid Base58 character: ${char}`);
    }
    value = value * 58n + BigInt(digit);
  }
  // Count leading '1's: each one is a leading zero byte.
  let leadingZeros = 0;
  for (const char of input) {
    if (char !== '1') break;
    leadingZeros += 1;
  }
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes]);
}

// Normalize the MPC derived_public_key result into the 64 raw bytes
// (x || y) of the uncompressed secp256k1 public key. The contract may
// return the key in more than one shape depending on the client, so
// every plausible shape is handled here.
function derivedKeyToRawBytes(derivedPublicKey) {
  // Shape 1: "secp256k1:<base58>" string (the usual NEAR representation).
  if (typeof derivedPublicKey === 'string') {
    const key = derivedPublicKey.trim();
    if (key.startsWith('secp256k1:')) {
      const raw = decodeBase58(key.slice('secp256k1:'.length));
      if (raw.length === 64) return raw;
      if (raw.length === 65 && raw[0] === 0x04) return raw.slice(1);
      throw new Error(
        `Unexpected decoded secp256k1 key length: ${raw.length} bytes`
      );
    }
    // Shape 2: hex string, with or without a 0x prefix.
    if (/^(0x)?[0-9a-fA-F]+$/.test(key)) {
      const bytes = ethers.getBytes(key);
      if (bytes.length === 64) return bytes;
      if (bytes.length === 65 && bytes[0] === 0x04) return bytes.slice(1);
      throw new Error(
        `Unexpected hex public key length: ${bytes.length} bytes`
      );
    }
    throw new Error(`Unrecognized derived public key string: ${key}`);
  }

  // Shape 3: raw byte array (e.g. [x0, x1, ...] or a Uint8Array).
  if (Array.isArray(derivedPublicKey) || derivedPublicKey instanceof Uint8Array) {
    const bytes = Uint8Array.from(derivedPublicKey);
    if (bytes.length === 64) return bytes;
    if (bytes.length === 65 && bytes[0] === 0x04) return bytes.slice(1);
    throw new Error(
      `Unexpected derived public key byte length: ${bytes.length} bytes`
    );
  }

  throw new Error(
    `Unrecognized derived public key type: ${typeof derivedPublicKey}`
  );
}

// Compute an EVM address from the 64 raw bytes (x || y) of an
// uncompressed secp256k1 public key: keccak256(x || y), last 20 bytes.
function evmAddressFromRawPublicKey(rawBytes) {
  const hash = ethers.keccak256(rawBytes);
  return ethers.getAddress('0x' + hash.slice(-40));
}

// ---------------------------------------------------------------------------
// Agent identity — NEAR chain signatures (MPC) derivation
// ---------------------------------------------------------------------------

// Derive the agent's EVM address from its NEAR testnet account via the
// chain-signatures MPC contract (a public view call, no key needed).
//
// Returns:
//   {
//     nearAccountId: 'minthunter.testnet',
//     evmAddress:    '0x...' (checksummed),
//     derivationPath: 'near',
//     source: 'chain-signatures-mpc' | 'local-fallback'
//   }
//
// If the MPC view call fails for any reason (network, RPC, contract),
// a deterministic fallback address is computed instead and the
// source field says so. This function never throws.
async function getAgentIdentity() {
  const nearAccountId = AGENT_NEAR_ACCOUNT_ID;
  const derivationPath = DERIVATION_PATH;

  try {
    // Connect to NEAR testnet. A view call needs no key, but near-api-js
    // still requires a key store object, so an empty in-memory one is used.
    const near = await nearAPI.connect({
      networkId: 'testnet',
      nodeUrl: NEAR_RPC_URL,
      keyStore: new nearAPI.keyStores.InMemoryKeyStore(),
    });
    const account = await near.account(nearAccountId);

    // Call the MPC contract's derived_public_key view method.
    const derivedPublicKey = await account.viewFunction({
      contractId: MPC_CONTRACT_ID,
      methodName: 'derived_public_key',
      args: { predecessor: nearAccountId, path: derivationPath },
    });

    const rawBytes = derivedKeyToRawBytes(derivedPublicKey);
    const evmAddress = evmAddressFromRawPublicKey(rawBytes);

    console.log(
      `[near] Derived EVM address ${evmAddress} for ${nearAccountId} ` +
        `(path "${derivationPath}") via chain-signatures MPC contract ${MPC_CONTRACT_ID}.`
    );

    return {
      nearAccountId,
      evmAddress,
      derivationPath,
      source: 'chain-signatures-mpc',
    };
  } catch (error) {
    // Fallback: deterministic address from keccak256("<account>:<path>").
    // This is NOT the real MPC derivation — it only keeps the demo
    // running when the MPC view call is unavailable.
    console.warn(
      `[near] WARNING: MPC derivation failed (${error && error.message ? error.message : error}). ` +
        'Falling back to a deterministic local address. ' +
        'This fallback address is NOT the chain-signatures derivation ' +
        'and must not be used for real cross-chain execution.'
    );

    const fallbackHash = ethers.keccak256(
      ethers.toUtf8Bytes(`${nearAccountId}:${derivationPath}`)
    );
    const evmAddress = ethers.getAddress('0x' + fallbackHash.slice(-40));

    return {
      nearAccountId,
      evmAddress,
      derivationPath,
      source: 'local-fallback',
    };
  }
}

// ---------------------------------------------------------------------------
// NEAR Intents quote — 1Click API (quote only, no execution)
// ---------------------------------------------------------------------------

// Request a swap quote from the NEAR Intents 1Click API.
//
// params (all optional, sensible demo defaults):
//   fromAsset — origin asset id, e.g. 'nep141:wrap.testnet'
//   toAsset   — destination asset id, e.g. 'nep141:usdc.testnet'
//   amount    — input amount in the origin asset's smallest unit,
//               as a string (default: 1 NEAR = 10^24 yoctoNEAR)
//   fromChain / toChain — informational labels for the demo only;
//               the 1Click API identifies chains via the asset ids.
//   recipient — address that receives the destination asset
//               (default: the agent's own NEAR testnet account).
//   refundTo / refundType — where a failed swap is refunded to
//               (defaults: the agent's NEAR testnet account, on the
//               origin chain). These fields, plus recipientType and
//               deadline, are required by the live 1Click API even
//               for a dry (quote-only) request; without them it
//               answers HTTP 400.
//
// Asset ids follow the 1Click format, e.g. 'nep141:wrap.testnet' for
// wrapped NEAR on NEAR testnet and 'nep141:usdc.testnet' for USDC on
// NEAR testnet. Cross-chain examples use the same scheme with the
// destination chain's asset id.
//
// NOTE (verified 2026-11-14): the live 1Click API is mainnet-only —
// its token list (GET /v0/tokens, 231 assets) contains zero testnet
// assets, so the default testnet pair below is rejected with
// "tokenIn is not valid" and this helper returns a stub. That is the
// documented, expected outcome for the testnet demo. Passing mainnet
// asset ids instead returns a real dry quote, e.g. fromAsset
// 'nep141:wrap.near' toAsset
// 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'
// (USDC on NEAR mainnet) with a mainnet recipient account such as
// 'poolv1.near' quoted 1 wNEAR -> ~3.415 USDC. A dry quote never
// moves funds either way.
//
// On success returns { stub: false, quote } with the raw quote object.
// On any failure (network, API error, bad asset) returns
// { stub: true, reason } and never throws. This helper only fetches a
// quote; live execution is explicitly out of scope for the demo, and
// no funds are ever spent here.
async function getIntentsQuote(params = {}) {
  const {
    fromAsset = 'nep141:wrap.testnet',
    toAsset = 'nep141:usdc.testnet',
    amount = '1000000000000000000000000', // 1 NEAR (24 decimals)
    fromChain = 'near-testnet',
    toChain = 'near-testnet',
    // Quote-only defaults: everything settles to the agent's own
    // testnet account, and dry: true means no swap is executed.
    recipient = AGENT_NEAR_ACCOUNT_ID,
    refundTo = AGENT_NEAR_ACCOUNT_ID,
    refundType = 'ORIGIN_CHAIN',
    recipientType = 'DESTINATION_CHAIN',
    // Quotes expire quickly; one hour is ample for a dry quote.
    deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  } = params;

  const body = {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    depositType: 'ORIGIN_CHAIN',
    originAsset: fromAsset,
    destinationAsset: toAsset,
    amount: String(amount),
    recipient,
    recipientType,
    refundTo,
    refundType,
    deadline,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
      response = await fetch(INTENTS_QUOTE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // A browser User-Agent: some API front-ends reject bare
          // script clients, and this keeps the demo request accepted.
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const reason =
        `Intents API returned HTTP ${response.status}` +
        (detail ? `: ${detail.slice(0, 200)}` : '');
      console.warn(`[near] Intents quote unavailable — ${reason}`);
      return { stub: true, reason };
    }

    const data = await response.json();
    // The API wraps the quote in a "quote" field; fall back to the
    // whole payload if it is already the quote object.
    const quote = data && data.quote ? data.quote : data;

    console.log(
      `[near] Intents quote received (${fromChain} ${fromAsset} -> ` +
        `${toChain} ${toAsset}, amount ${amount}).`
    );

    return { stub: false, quote };
  } catch (error) {
    const reason =
      error && error.name === 'AbortError'
        ? 'Intents API request timed out'
        : `Intents quote request failed: ${error && error.message ? error.message : error}`;
    console.warn(`[near] Intents quote unavailable — ${reason}`);
    return { stub: true, reason };
  }
}

module.exports = { getAgentIdentity, getIntentsQuote };
