// demo-live-mint.js — reproduce the live testnet mint with a fresh wallet.
//
// Flow (wallet key never touches disk):
//   1. Load the deployed demo contract from agent/demo-contract.json
//      (written by agent/deploy-demo.js). Exits clearly if not deployed yet.
//   2. Generate a FRESH test wallet in memory. Print ONLY its public
//      address. Never print, log, or write the private key.
//   3. Wait for that address to be funded with tBNB (poll every 30 s, up
//      to 30 minutes). Fund it via https://testnet.bnbchain.org/faucet-smart
//      (or an equivalent faucet).
//   4. Run the agent verifier against the demo contract (expect SAFE).
//   5. Run the minter with the same in-memory wallet (expect a real mint).
//   6. Append the mint to agent/demo-proof.json and print explorer links.
//
// Run: node agent/demo-live-mint.js
// Testnet only. Never mainnet, never real funds, never a real key.

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const { verify } = require('./verifier.js');
const { mintIfSafe } = require('./minter.js');

const TESTNET_RPC = 'https://data-seed-prebsc-1-s1.binance.org:8545';
const TESTNET_CHAIN_ID = 97;
const FAUCET_URL = 'https://testnet.bnbchain.org/faucet-smart';
const EXPLORER_TX = (hash) => `https://testnet.bscscan.com/tx/${hash}`;
const EXPLORER_ADDR = (addr) => `https://testnet.bscscan.com/address/${addr}`;

const FUND_WAIT_MS = 30 * 60 * 1000;
const FUND_POLL_MS = 30 * 1000;
const MIN_FUND_WEI = ethers.parseEther('0.002');

const DEMO_CONTRACT_PATH = path.join(__dirname, 'demo-contract.json');
const DEMO_PROOF_PATH = path.join(__dirname, 'demo-proof.json');

function log(msg) {
  console.log(`[demo-live-mint] ${msg}`);
}

async function main() {
  log('=== MintHunter live-mint demo started ===');

  if (!fs.existsSync(DEMO_CONTRACT_PATH)) {
    log(`no deployed demo contract found at ${DEMO_CONTRACT_PATH}.`);
    log('Run `node agent/deploy-demo.js` first (it deploys the contract).');
    process.exitCode = 2;
    return;
  }
  const demo = JSON.parse(fs.readFileSync(DEMO_CONTRACT_PATH, 'utf8'));
  const candidate = {
    contract: demo.contract,
    name: demo.name || 'MintHunter Demo (testnet)',
    chainId: 97,
    source: 'testnet-demo',
  };
  log(`demo contract: ${candidate.contract} (${EXPLORER_ADDR(candidate.contract)})`);

  const wallet = ethers.Wallet.createRandom();
  const provider = new ethers.JsonRpcProvider(TESTNET_RPC, TESTNET_CHAIN_ID);
  const connected = wallet.connect(provider);
  log(`FRESH TEST WALLET (public address only): ${wallet.address}`);
  log('Its private key is in memory only and is never printed or written.');
  log(`Fund it with tBNB via ${FAUCET_URL} (or an equivalent faucet).`);

  const started = Date.now();
  let funded = false;
  while (Date.now() - started < FUND_WAIT_MS) {
    let balance = 0n;
    try {
      balance = await provider.getBalance(wallet.address);
    } catch (err) {
      log(`balance check failed (${err.message}); retrying...`);
    }
    if (balance >= MIN_FUND_WEI) {
      log(`funded: ${ethers.formatEther(balance)} tBNB.`);
      funded = true;
      break;
    }
    await new Promise((r) => setTimeout(r, FUND_POLL_MS));
  }
  if (!funded) {
    log(`NOT FUNDED within ${FUND_WAIT_MS / 60000} minutes. Exiting (code 2).`);
    log(`To retry: fund ${wallet.address} with tBNB, then re-run this script.`);
    log('NOTE: a re-run generates a NEW wallet address, so fund the address');
    log('printed by the new run, not this one.');
    process.exitCode = 2;
    return;
  }

  log('running the agent verifier...');
  let verification;
  try {
    verification = await verify(candidate);
  } catch (err) {
    verification = { contract: candidate.contract, verdict: 'UNSAFE', reasons: [`verification error: ${err.message}`] };
  }
  log(`verdict: ${verification.verdict}`);
  for (const reason of verification.reasons) log(`  - ${reason}`);

  let mintResult = { minted: false, reason: 'not attempted' };
  if (verification.verdict === 'SAFE') {
    try {
      mintResult = await mintIfSafe(candidate, verification, connected);
    } catch (err) {
      mintResult = { minted: false, reason: `minter error: ${err.message}` };
    }
  } else {
    log('mint skipped: candidate is not SAFE.');
  }

  if (mintResult.minted) {
    log(`MINTED! tx: ${mintResult.txHash} (${mintResult.explorerUrl})`);
  } else {
    log(`mint not completed: ${mintResult.reason}`);
  }

  // Append this mint to the proof file (public info only).
  let proof = {};
  try {
    proof = JSON.parse(fs.readFileSync(DEMO_PROOF_PATH, 'utf8'));
  } catch {
    proof = { contract: candidate.contract, chainId: 97, chain: 'BSC testnet' };
  }
  proof.mints = proof.mints || [];
  proof.mints.push({
    minter: wallet.address,
    minted: !!mintResult.minted,
    txHash: mintResult.minted ? mintResult.txHash : null,
    explorerUrl: mintResult.minted ? mintResult.explorerUrl : null,
    reason: mintResult.minted ? null : mintResult.reason,
    at: new Date().toISOString(),
  });
  // Keep the first mint as the headline proof fields too.
  if (mintResult.minted && !proof.mintTxHash) {
    proof.minted = true;
    proof.mintTxHash = mintResult.txHash;
    proof.mintTxExplorerUrl = mintResult.explorerUrl;
  }
  fs.writeFileSync(DEMO_PROOF_PATH, JSON.stringify(proof, null, 2));
  log(`updated ${DEMO_PROOF_PATH} (public info only)`);

  console.log('\n=== MintHunter live-mint demo summary ===');
  console.log(`Contract: ${candidate.contract}`);
  if (mintResult.minted) {
    console.log(`Mint tx: ${mintResult.txHash} (${mintResult.explorerUrl})`);
  } else {
    console.log(`Mint: NOT completed (${mintResult.reason})`);
  }
  console.log('=== MintHunter live-mint demo finished ===');
  process.exitCode = mintResult.minted ? 0 : 1;
}

main().catch((err) => {
  console.error(`[demo-live-mint] Fatal error: ${err.message}`);
  process.exit(1);
});
