// run.js — MintHunter main loop: HUNT -> VERIFY -> MINT -> REPORT.
// Runnable with `node agent/run.js` from the repo root. Completes one pass
// and exits cleanly (exit code 0) even when candidates are UNSAFE or the
// mint is skipped for lack of testnet funds.
//
// NOTE: package.json declares "type": "commonjs", so this file uses
// require() — the imported names (hunt, verify, mintIfSafe,
// getAgentIdentity) match the module contract exactly.

const fs = require('fs');
const path = require('path');

const { hunt } = require('./hunter.js');
const { verify } = require('./verifier.js');
const { mintIfSafe } = require('./minter.js');

// near.js is built by a teammate in parallel. If it is not ready yet, fall
// back to a placeholder identity and keep going — never crash the pass.
let getAgentIdentity;
try {
  ({ getAgentIdentity } = require('./near.js'));
} catch (err) {
  console.log(`[run] near.js not available yet (${err.message}); using placeholder identity.`);
  getAgentIdentity = async () => ({
    nearAccountId: 'minthunter.testnet',
    evmAddress: '0x0000000000000000000000000000000000000000',
    derivationPath: 'near',
    source: 'pending',
  });
}

const OUTPUT_PATH = path.join(__dirname, '..', 'dashboard', 'data.json');

async function main() {
  console.log('=== MintHunter agent pass started ===');

  let identity;
  try {
    identity = await getAgentIdentity();
  } catch (err) {
    console.log(`[run] getAgentIdentity failed (${err.message}); using placeholder identity.`);
    identity = {
      nearAccountId: 'minthunter.testnet',
      evmAddress: '0x0000000000000000000000000000000000000000',
      derivationPath: 'near',
      source: 'pending',
    };
  }
  console.log(`[run] Agent identity: ${identity.nearAccountId} (EVM ${identity.evmAddress}, source: ${identity.source})`);

  const candidates = await hunt();

  const hunts = [];
  for (const candidate of candidates) {
    console.log(`\n--- Candidate: ${candidate.name} (${candidate.contract}) ---`);
    let verification;
    try {
      verification = await verify(candidate);
    } catch (err) {
      console.log(`[run] Verification crashed for ${candidate.contract}: ${err.message}`);
      verification = { contract: candidate.contract, verdict: 'UNSAFE', reasons: [`verification error: ${err.message}`] };
    }
    console.log(`[run] Verdict: ${verification.verdict}`);
    for (const reason of verification.reasons) console.log(`[run]   - ${reason}`);

    let mintResult = { minted: false, reason: 'not attempted' };
    if (verification.verdict === 'SAFE') {
      try {
        mintResult = await mintIfSafe(candidate, verification);
      } catch (err) {
        mintResult = { minted: false, reason: `minter error: ${err.message}` };
      }
    } else {
      console.log(`[run] Mint skipped: candidate is ${verification.verdict}.`);
    }
    if (mintResult.minted) {
      console.log(`[run] Minted! tx: ${mintResult.txHash} (${mintResult.explorerUrl})`);
    } else if (mintResult.reason && mintResult.reason !== 'not attempted') {
      console.log(`[run] Mint not completed: ${mintResult.reason}`);
    }

    hunts.push({
      contract: candidate.contract,
      name: candidate.name,
      chainId: candidate.chainId,
      verdict: verification.verdict,
      reasons: verification.reasons,
      txHash: mintResult.minted ? mintResult.txHash : null,
      explorerUrl: mintResult.minted ? mintResult.explorerUrl : null,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    nearAccountId: identity.nearAccountId,
    derivedEvmAddress: identity.evmAddress,
    hunts,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n[run] Report written to ${OUTPUT_PATH}`);

  const safe = hunts.filter((h) => h.verdict === 'SAFE').length;
  const unsafe = hunts.filter((h) => h.verdict === 'UNSAFE').length;
  const minted = hunts.filter((h) => h.txHash).length;
  console.log('\n=== MintHunter summary ===');
  console.log(`Candidates checked: ${hunts.length}`);
  console.log(`SAFE: ${safe} | UNSAFE: ${unsafe} | Minted: ${minted}`);
  for (const h of hunts) {
    console.log(`- ${h.name} (${h.contract}): ${h.verdict}${h.txHash ? ` — tx ${h.txHash}` : ''}`);
  }
  console.log('=== MintHunter agent pass finished ===');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[run] Fatal error: ${err.message}`);
    process.exit(1);
  });
