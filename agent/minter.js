// minter.js — executes the mint on BSC TESTNET (chainId 97) only.
// Safety rules:
//   - Only mints when verification.verdict === 'SAFE'.
//   - Always uses a FRESH, randomly generated test wallet created in code.
//     No real private key is ever used or stored.
//   - A test wallet with 0 tBNB is a normal demo state: report it and stop,
//     never crash. Fund it at https://testnet.bnbchain.org/faucet-smart.

const { ethers } = require('ethers');

const TESTNET_RPC = 'https://data-seed-prebsc-1-s1.binance.org:8545';
const TESTNET_CHAIN_ID = 97;
const FAUCET_URL = 'https://testnet.bnbchain.org/faucet-smart';
const EXPLORER_TX = (hash) => `https://testnet.bscscan.com/tx/${hash}`;

// Minimal ABI for the free mint entry points used by the curated contracts.
const MINT_ABI = [
  'function mintFree()',
  'function freeMint()',
  'function claimFree()',
  'function freeClaim()',
  'function mint()',
  'function claim()',
];

async function mintIfSafe(candidate, verification, providedWallet) {
  if (!verification || verification.verdict !== 'SAFE') {
    const reason = verification
      ? `verification verdict is ${verification.verdict} — mint refused`
      : 'no verification provided — mint refused';
    console.log(`[minter] Skipping ${candidate.contract}: ${reason}.`);
    return { minted: false, reason };
  }

  // Testnet-only demo wallet. When the caller passes an already-funded
  // in-memory wallet (the deploy/demo flow), use it; otherwise generate a
  // fresh, randomly generated test wallet in code. No real private key is
  // ever used, stored, or written to disk by this module.
  const wallet = providedWallet || ethers.Wallet.createRandom();
  if (providedWallet) {
    console.log(`[minter] Using caller-provided testnet wallet: ${wallet.address}`);
  } else {
    console.log(`[minter] Fresh testnet-only demo wallet generated: ${wallet.address}`);
  }
  console.log('[minter] This is a throwaway testnet wallet. Never send mainnet funds to it.');

  const provider = new ethers.JsonRpcProvider(TESTNET_RPC, TESTNET_CHAIN_ID);
  const connected = wallet.connect(provider);

  let balance;
  try {
    balance = await provider.getBalance(wallet.address);
  } catch (err) {
    return { minted: false, reason: `testnet balance check failed (${err.message})` };
  }
  console.log(`[minter] Test wallet balance: ${ethers.formatEther(balance)} tBNB.`);
  if (balance === 0n) {
    return {
      minted: false,
      reason: `test wallet has 0 tBNB — fund via ${FAUCET_URL}`,
    };
  }

  const fnName = verification.freeFunction && MINT_ABI.some((s) => s.includes(verification.freeFunction))
    ? verification.freeFunction
    : 'mintFree';
  // NOTE: the candidate contracts live on BSC mainnet (chain 56); this demo
  // mints on testnet (chain 97), so the same contract address is not
  // deployed there. The call below targets the candidate address on testnet
  // and will fail cleanly if nothing is deployed at that address — that is
  // expected demo behaviour, reported rather than hidden.
  const contract = new ethers.Contract(candidate.contract, MINT_ABI, connected);
  try {
    const tx = await contract[fnName]({ value: 0 });
    console.log(`[minter] Mint tx sent: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt.status !== 1n && receipt.status !== 1) {
      return { minted: false, reason: `mint transaction reverted (${tx.hash})` };
    }
    return { minted: true, txHash: tx.hash, explorerUrl: EXPLORER_TX(tx.hash) };
  } catch (err) {
    return { minted: false, reason: `mint call failed (${err.message})` };
  }
}

module.exports = { mintIfSafe, TESTNET_CHAIN_ID, FAUCET_URL };
