// deploy-demo.js — deploy the MintHunter demo free-mint contract to BSC
// testnet (chain 97) and prove the agent can mint from it end to end.
//
// Flow (all in one process, wallet key never touches disk):
//   1. Generate a FRESH test wallet in memory. Print ONLY its public
//      address. Never print, log, or write the private key.
//   2. Wait for that address to be funded with tBNB (poll every 30 s, up
//      to FUND_WAIT_MS). Funding comes from a testnet faucet — see README.
//      The script exits gracefully (code 2) if funding never arrives.
//   3. Deploy contracts/MintHunterDemo.sol from the funded wallet.
//   4. Write agent/demo-contract.json (public info only: contract address,
//      deploy tx, deployer address, chain, name). No private key.
//   5. Attempt Sourcify source verification (chain 97). Log the result.
//   6. Run the agent verifier against the deployed contract (expect SAFE).
//   7. Run the minter with the same in-memory wallet (expect a real mint).
//   8. Write agent/demo-proof.json (public info only) and print a summary
//      with testnet explorer links.
//
// Run: node agent/deploy-demo.js
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
const SOURCIFY_VERIFY_URL = 'https://sourcify.dev/server/v2/contract/97';

// How long to wait for funding before giving up (4 hours). The deploy
// needs ~0.005 tBNB and the mint ~0.0005 tBNB; require at least 0.002.
const FUND_WAIT_MS = 4 * 60 * 60 * 1000;
const FUND_POLL_MS = 30 * 1000;
const MIN_FUND_WEI = ethers.parseEther('0.002');

const ARTIFACT_PATH = path.join(__dirname, '..', 'contracts', 'build', 'MintHunterDemo.json');
const CONTRACTS_DIR = path.join(__dirname, '..', 'contracts');
const DEMO_CONTRACT_PATH = path.join(__dirname, 'demo-contract.json');
const DEMO_PROOF_PATH = path.join(__dirname, 'demo-proof.json');

function log(msg) {
  console.log(`[deploy-demo] ${msg}`);
}

// Collect every source file listed in the solc metadata, reading contents
// from disk (main contract from contracts/, OpenZeppelin from node_modules).
function collectSources(metadata) {
  const meta = JSON.parse(metadata);
  const files = [];
  for (const sourcePath of Object.keys(meta.sources || {})) {
    let diskPath;
    if (sourcePath === 'MintHunterDemo.sol') {
      diskPath = path.join(CONTRACTS_DIR, 'MintHunterDemo.sol');
    } else if (sourcePath.startsWith('@openzeppelin/contracts/')) {
      diskPath = path.join(__dirname, '..', 'node_modules', sourcePath);
    } else {
      diskPath = path.join(CONTRACTS_DIR, sourcePath);
    }
    const content = fs.readFileSync(diskPath, 'utf8');
    files.push({ path: sourcePath, content });
  }
  return files;
}

// Attempt Sourcify source verification for chain 97. Returns
// { verified: boolean, detail: string }. Never throws.
async function verifyOnSourcify(contractAddress, artifact) {
  try {
    const files = collectSources(artifact.metadata);
    const form = new FormData();
    for (const file of files) {
      form.append('files', new Blob([file.content], { type: 'text/plain' }), file.path);
    }
    form.append('files', new Blob([artifact.metadata], { type: 'application/json' }), 'metadata.json');
    form.append('chosenContract', 'MintHunterDemo.sol:MintHunterDemo');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    let res;
    try {
      res = await fetch(SOURCIFY_VERIFY_URL, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (res.ok) {
      return { verified: true, detail: `Sourcify accepted the verification (${res.status}). ${body && body.message ? body.message : ''}`.trim() };
    }
    return { verified: false, detail: `Sourcify returned HTTP ${res.status}: ${text.slice(0, 300)}` };
  } catch (err) {
    return { verified: false, detail: `Sourcify verification request failed: ${err.message}` };
  }
}

async function waitForFunding(provider, address) {
  const started = Date.now();
  let polls = 0;
  while (Date.now() - started < FUND_WAIT_MS) {
    polls += 1;
    let balance = 0n;
    try {
      balance = await provider.getBalance(address);
    } catch (err) {
      log(`balance check failed (${err.message}); retrying...`);
    }
    if (balance >= MIN_FUND_WEI) {
      log(`funded: ${ethers.formatEther(balance)} tBNB (after ${polls} poll(s)).`);
      return balance;
    }
    if (polls === 1 || polls % 10 === 0) {
      const waitedMin = Math.round((Date.now() - started) / 60000);
      log(
        `waiting for funding... balance ${ethers.formatEther(balance)} tBNB, ` +
          `need >= ${ethers.formatEther(MIN_FUND_WEI)} tBNB ` +
          `(waited ${waitedMin} min, up to ${FUND_WAIT_MS / 60000} min). ` +
          `Fund ${address} via ${FAUCET_URL} (or an equivalent faucet).`,
      );
    }
    await new Promise((r) => setTimeout(r, FUND_POLL_MS));
  }
  return null;
}

async function main() {
  log('=== MintHunter demo deploy started ===');
  log('BSC testnet only (chain 97). No mainnet, no real funds, no real keys.');

  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
  log(`loaded artifact ${artifact.contractName} (solc ${artifact.compilerVersion})`);

  // 1. Fresh wallet, in memory only.
  const wallet = ethers.Wallet.createRandom();
  const provider = new ethers.JsonRpcProvider(TESTNET_RPC, TESTNET_CHAIN_ID);
  const deployer = wallet.connect(provider);
  log(`FRESH TEST WALLET (public address only): ${wallet.address}`);
  log('This is a throwaway testnet wallet. Its private key is in memory only');
  log('and is never printed, logged, or written to disk.');
  log(`Fund it with tBNB via ${FAUCET_URL} (or an equivalent faucet).`);
  log(`Explorer: ${EXPLORER_ADDR(wallet.address)}`);

  // 2. Wait for funding.
  const balance = await waitForFunding(provider, wallet.address);
  if (balance === null) {
    log(`NOT FUNDED within ${FUND_WAIT_MS / 60000} minutes. Exiting (code 2).`);
    log(`To retry: fund ${wallet.address} with tBNB, then re-run this script.`);
    log('NOTE: a re-run generates a NEW wallet address, so fund the address');
    log('printed by the new run, not this one.');
    process.exitCode = 2;
    return;
  }

  // 3. Deploy.
  log('deploying MintHunterDemo...');
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  let contract;
  let deployTxHash;
  try {
    contract = await factory.deploy();
    deployTxHash = contract.deploymentTransaction().hash;
    log(`deploy tx sent: ${deployTxHash} (${EXPLORER_TX(deployTxHash)})`);
    await contract.waitForDeployment();
  } catch (err) {
    log(`DEPLOY FAILED: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const contractAddress = await contract.getAddress();
  log(`DEPLOYED MintHunterDemo at ${contractAddress}`);
  log(`Explorer: ${EXPLORER_ADDR(contractAddress)}`);

  // 4. Write the public demo-contract record (no private key).
  const demoContract = {
    contract: contractAddress,
    name: 'MintHunter Demo (testnet)',
    chainId: 97,
    source: 'testnet-demo',
    deployer: wallet.address,
    deployTxHash,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(DEMO_CONTRACT_PATH, JSON.stringify(demoContract, null, 2));
  log(`wrote ${DEMO_CONTRACT_PATH} (public info only)`);

  // 5. Sourcify verification (best effort; logged honestly).
  log('attempting Sourcify source verification (chain 97)...');
  const sourcify = await verifyOnSourcify(contractAddress, artifact);
  log(`Sourcify: ${sourcify.detail}`);

  // 6. Run the agent verifier against the deployed contract.
  const candidate = {
    contract: contractAddress,
    name: 'MintHunter Demo (testnet)',
    chainId: 97,
    source: 'testnet-demo',
  };
  log('running the agent verifier against the deployed contract...');
  let verification;
  try {
    verification = await verify(candidate);
  } catch (err) {
    verification = { contract: contractAddress, verdict: 'UNSAFE', reasons: [`verification error: ${err.message}`] };
  }
  log(`verdict: ${verification.verdict}`);
  for (const reason of verification.reasons) log(`  - ${reason}`);

  // 7. Mint with the same in-memory wallet (it has not minted yet).
  let mintResult = { minted: false, reason: 'not attempted' };
  if (verification.verdict === 'SAFE') {
    try {
      mintResult = await mintIfSafe(candidate, verification, deployer);
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

  // 8. Write the public proof (no private key) and print a summary.
  const proof = {
    generatedAt: new Date().toISOString(),
    chainId: 97,
    chain: 'BSC testnet',
    deployer: wallet.address,
    contract: contractAddress,
    contractExplorerUrl: EXPLORER_ADDR(contractAddress),
    deployTxHash,
    deployTxExplorerUrl: EXPLORER_TX(deployTxHash),
    sourcifyVerified: sourcify.verified,
    sourcifyDetail: sourcify.detail,
    verificationVerdict: verification.verdict,
    verificationReasons: verification.reasons,
    freeFunction: verification.freeFunction || null,
    minted: !!mintResult.minted,
    mintTxHash: mintResult.minted ? mintResult.txHash : null,
    mintTxExplorerUrl: mintResult.minted ? mintResult.explorerUrl : null,
    mintReason: mintResult.minted ? null : mintResult.reason,
  };
  fs.writeFileSync(DEMO_PROOF_PATH, JSON.stringify(proof, null, 2));
  log(`wrote ${DEMO_PROOF_PATH} (public info only)`);

  console.log('\n=== MintHunter demo deploy summary ===');
  console.log(`Contract: ${contractAddress} (${EXPLORER_ADDR(contractAddress)})`);
  console.log(`Deploy tx: ${deployTxHash} (${EXPLORER_TX(deployTxHash)})`);
  console.log(`Sourcify verified: ${sourcify.verified}`);
  console.log(`Verifier verdict: ${verification.verdict}`);
  if (mintResult.minted) {
    console.log(`Mint tx: ${mintResult.txHash} (${mintResult.explorerUrl})`);
  } else {
    console.log(`Mint: NOT completed (${mintResult.reason})`);
  }
  console.log('=== MintHunter demo deploy finished ===');

  process.exitCode = mintResult.minted ? 0 : 1;
}

main().catch((err) => {
  console.error(`[deploy-demo] Fatal error: ${err.message}`);
  process.exit(1);
});
