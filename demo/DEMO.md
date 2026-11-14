# MintHunter — demo script (2–3 minutes)

This is the walkthrough for a judge. Everything runs locally; no account, no signup, no real funds.

## Setup (30 seconds)

```sh
git clone <this repo>
cd minthunter
npm install
```

## Run the agent (60 seconds)

```sh
node agent/run.js
```

What you will see in the console:

- The agent identity: NEAR testnet account `minthunter.testnet` and its EVM address derived via chain signatures (`0xBAE086017b4aA482b5264DBc37bC620aAB1a9DFE`).
- The hunt: 9 candidates found (live MintRadar leads plus a curated list of real BSC free mints).
- The verification: one verdict per candidate, SAFE or UNSAFE, with reasons.
- The mint step: SAFE candidates are queued for a BSC testnet mint. The fresh test wallet holds 0 tBNB, so the demo reports them as skipped with a faucet link (see "Live mint" below).

## Open the dashboard (30 seconds)

```sh
npx --yes serve -l 8080 dashboard
# open http://localhost:8080
```

Or open `dashboard/index.html` directly. You will see the mission control: agent identity, a stats bar, and one card per hunt with a green SAFE or red UNSAFE badge, the reasons, and any transaction link.

## The key moment — the EIP-7702 catch (30 seconds)

Find the card for the drained wallet `0xd24afeCEF683BB9E35d78e91ed4198bA9E59a233`. It is flagged UNSAFE with the reason "EIP-7702 delegation to 0x86e415756170ef48e0e9052b8a8a7bd4783a77ca (unknown delegate)".

That wallet was drained on 2026-11-11 through an EIP-7702 phishing delegation. The delegation has changed twice since: first to `0xe25db171b622ce6f9e262a0ac84d73790bb54365`, now to a third address the verifier had never seen before. The verifier caught it live because it checks `eth_getCode` for the `0xef0100` delegation prefix on every candidate — it does not rely on a static blocklist.

For contrast, open the Agentic (AGTC) card: SAFE, with "source verified", "free mint confirmed (mintFree)", "no delegation", and "no drain patterns".

## Live mint (optional, needs a faucet)

The minter runs on BSC testnet (chain id 97) and generates a fresh test wallet per run. To see a live mint:

1. Copy the test wallet address from the `node agent/run.js` output.
2. Fund it with tBNB at https://testnet.bnbchain.org/faucet-smart.
3. Re-run `node agent/run.js`.

Note: the curated contracts in the demo list live on BSC mainnet (chain 56) and are not deployed on testnet, so a funded mint against those addresses would revert with "no code at address". A testnet-deployed demo free-mint contract is the follow-up for a live mint end-to-end. The hunt, verify, and report stages are fully live either way.

## What to look at in the code

- `agent/verifier.js` — the five-check safety gate (Sourcify, free mint, excluded deployer, EIP-7702 delegation, drain patterns).
- `agent/near.js` — chain-signatures MPC derivation (`derived_public_key` view call on `v1.signer-prod.testnet`) and the NEAR Intents 1Click dry-quote attempt.
- `agent/hunter.js` — live MintRadar fetch with a curated fallback.
- `agent/minter.js` — testnet-only mint, fresh wallet per run, 0-balance handled gracefully.
