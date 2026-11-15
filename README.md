# MintHunter

## What it is

MintHunter is an autonomous free-mint hunter agent for AI agent wallets. You give it no instructions after launch: it finds new free NFT mints, verifies each contract is safe, mints the safe ones on testnet, and reports everything on a dashboard. One command, one pass, no human in the loop.

**Primary track:** Agent Economy (`agents`).
**Event:** NEAR Hackathon 2026. Built 2026-11-14. Submission deadline 2026-11-14T23:59:00Z.

## The problem

AI agent wallets transact on their own. There is no human clicking "reject" when a malicious contract asks for approval. Existing wallet-security tools (Revoke.cash, Wallet Guard, Blowfish, Blockaid) protect humans who approve transactions manually. They do not protect an agent that mints a new contract at 3 a.m. with nobody watching.

The risk is not theoretical. The builder of this project had a wallet drained on 2026-11-11 through an EIP-7702 phishing delegation: the wallet was silently delegated to a phishing contract, and funds were swept by an automated attacker. The delegation has since changed twice more — the same wallet is now delegated to a third address (`0x86e415756170ef48e0e9052b8a8a7bd4783a77ca`), which MintHunter's verifier caught live during testing. Most tools do not check EIP-7702 delegation at all.

## The product

MintHunter is a four-stage autonomous loop:

1. **Hunt** — finds new free mints from a live source (MintRadar) plus a curated list of real BSC free-mint contracts.
2. **Verify** — a five-check safety gate per contract: (a) source verified on Sourcify, (b) mint confirmed free, (c) deployer not on the exclusion list, (d) no EIP-7702 delegation (any delegation is a fail; delegation to a known phishing contract is flagged by name), (e) no drain patterns in the source. Verdict is SAFE or UNSAFE with reasons.
3. **Mint** — executes the mint on BSC testnet for SAFE contracts only, from a fresh test wallet generated per run.
4. **Report** — writes every verdict, reason, and transaction to `dashboard/data.json` and renders it on a static mission-control dashboard.

The agent never touches mainnet, never spends real funds, and never handles a real private key.

## How NEAR fits

- **Chain signatures.** The agent's identity is a NEAR testnet account (`minthunter.testnet`). Its EVM address is derived from that account through the NEAR chain-signatures MPC contract (`v1.signer-prod.testnet`, `derived_public_key` view call) — a real, live derivation, not a mock. Derived EVM address: `0xBAE086017b4aA482b5264DBc37bC620aAB1a9DFE`.
- **NEAR Intents.** Cross-chain execution is routed through NEAR Intents (1Click API). `agent/near.js` attempts a real dry quote. Verified 2026-11-14: the live 1Click API is mainnet-only (its token list contains zero testnet assets), so a testnet pair returns an honest stub; a mainnet pair returns a real dry quote (1 wNEAR → ~3.415 USDC). A dry quote never moves funds. Live execution is out of scope for this demo.
- **NEAR AI Cloud.** The agent's reasoning (hunt → verify → mint policy) is designed to run as a NEAR AI agent; in this prototype it runs locally as a Node.js agent with the same decision policy.

## How to run it (2–3 minutes)

```sh
git clone <this repo>
cd minthunter
npm install
node agent/run.js
```

Then open the dashboard:

```sh
npx --yes serve -l 8080 dashboard
# open http://localhost:8080
```

Or open `dashboard/index.html` directly in a browser.

Expected output: the agent hunts 9 candidates, verifies each, and reports 5 SAFE / 4 UNSAFE in the demo run, including the drained wallet `0xd24a…` flagged UNSAFE for its EIP-7702 delegation. Mints show as "not minted" unless the fresh test wallet is funded — see below.

## Demo

See [demo/DEMO.md](demo/DEMO.md) for the 2–3 minute judge walkthrough, including the EIP-7702 drained-wallet example.

Watch the demo (34-second video, posted 2026-11-15): https://x.com/AirdropFlickers/status/2121748821923516448

## Configuration

No configuration file and no secrets. The only values a user might change are in the source:

- `agent/hunter.js` — the curated contract list and the live-source URL.
- `agent/verifier.js` — the excluded-deployer list and the known phishing delegation addresses.
- `agent/near.js` — the NEAR testnet account id (`minthunter.testnet`) and the derivation path (`near`).
- `agent/minter.js` — BSC testnet RPC and chain id (97).

## Testnet minting

The minter runs on BSC testnet (chain id 97) and generates a fresh test wallet per run. A fresh wallet holds 0 tBNB, so the demo run reports mints as skipped with a faucet link. The curated contracts in the demo list live on BSC mainnet (chain 56) and are not deployed on testnet, so a funded mint against those addresses would revert.

A testnet-deployed demo free-mint contract is included for a live mint end-to-end:

- `contracts/MintHunterDemo.sol` — minimal free-mint ERC-721 (`mintFree()`, 1 per wallet, no fee, no withdraw). Compile with `npm run compile`.
- `node agent/deploy-demo.js` — generates a fresh test wallet, prints its public address, waits for tBNB funding, deploys the contract, attempts Sourcify verification (chain 97), runs the agent verifier, mints once, and writes the proof to `agent/demo-proof.json`.
- `node agent/demo-live-mint.js` — reproduces the live mint with a fresh wallet against the deployed contract.

Status: the demo contract is compiled and the deploy script is ready; the live mint is pending tBNB funding for the generated test wallet (see [Limitations](#limitations)).

## Limitations

What is real in this prototype:

- Hunt from a live source (MintRadar) with a curated fallback.
- All five verifier checks, including live Sourcify fetches, live `eth_getCode` delegation checks, and live source reads.
- The EIP-7702 delegation catch on `0xd24a…` (a third, previously unknown delegate address).
- Chain-signatures EVM address derivation via the live MPC contract.
- A real NEAR Intents dry-quote attempt (returns a stub for testnet pairs because the API is mainnet-only; verified with a mainnet pair).

Known limitations — stubbed, mocked, or out of scope:

- **Live testnet mint end-to-end: not yet proven.** The demo contract (`contracts/MintHunterDemo.sol`) is written and compiled, and `agent/deploy-demo.js` is ready, but the live mint still needs tBNB funding for the generated test wallet. Until a mint transaction lands on BSC testnet, this is a limitation, not a demonstrated feature. See [Testnet minting](#testnet-minting).
- **NEAR Intents execution is a stub on testnet.** The 1Click API is mainnet-only, so testnet pairs return an honest stub; only a dry quote is ever attempted and no swap is executed. Live cross-chain execution is out of scope for this demo.
- **Local-only run, not NEAR AI Cloud yet.** The agent runs as a local Node.js process; the hunt → verify → mint policy is written to port to NEAR AI Cloud, but it is not hosted there in this prototype.
- **Curated list is mainnet contracts.** The curated free-mint contracts live on BSC mainnet (chain 56) and are not deployed on testnet, so the agent can verify them but cannot mint them on testnet. The testnet demo contract covers the mint path.
- **No mainnet execution, ever.** The agent never touches mainnet, never spends real funds, and never handles a real private key. That is a safety boundary, and also a limitation of what the demo can show.

## Repository layout

```
HACKATHON.md            NEAR Hackathon instructions (verbatim)
README.md               This file
LICENSE                 MIT
package.json            ethers v6, near-api-js v5
contracts/
  MintHunterDemo.sol    Demo free-mint ERC-721 (testnet)
  compile.js            Compile with solc + OpenZeppelin
  build/                Compiled artifact (generated)
agent/
  hunter.js             Find new free mints
  verifier.js           Five-check safety gate
  minter.js             BSC testnet mint (SAFE only)
  near.js               Chain signatures + Intents quote
  run.js                HUNT → VERIFY → MINT → REPORT
  deploy-demo.js        Deploy demo contract + live mint
  demo-live-mint.js     Reproduce the live mint
  demo-contract.json    Deployed demo contract (generated)
  demo-proof.json       Live-mint proof (generated)
dashboard/
  index.html            Mission-control UI
  app.js                Renders data.json
  style.css             Dark theme, SAFE/UNSAFE badges
  data.json             Latest run output (generated)
demo/
  DEMO.md               2–3 minute judge walkthrough
```

## Links

- NEAR Hackathon: https://nearhackathon.com
- NEAR docs: https://docs.near.org
- NEAR Intents: https://docs.near.org/chain-abstraction/intents
- Chain signatures: https://docs.near.org/chain-abstraction/chain-signatures
- BSC testnet explorer: https://testnet.bscscan.com
- BSC testnet faucet: https://testnet.bnbchain.org/faucet-smart
- Sourcify: https://sourcify.dev

## License

MIT. See [LICENSE](LICENSE).
