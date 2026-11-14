// compile.js — compile contracts/MintHunterDemo.sol with solc + OpenZeppelin.
// Run: node contracts/compile.js
// Output: contracts/build/MintHunterDemo.json { abi, bytecode, metadata }
// No network, no secrets. Reproducible: solc 0.8.38, optimizer off (keeps
// the deployed bytecode identical to what Sourcify expects from metadata).

const fs = require('fs');
const path = require('path');
const solc = require('solc');

const CONTRACTS_DIR = __dirname;
const BUILD_DIR = path.join(CONTRACTS_DIR, 'build');
const ENTRY = path.join(CONTRACTS_DIR, 'MintHunterDemo.sol');
const OZ_ROOT = path.join(__dirname, '..', 'node_modules', '@openzeppelin', 'contracts');

function findImports(importPath) {
  // OpenZeppelin imports resolve from node_modules/@openzeppelin/contracts.
  let fullPath;
  if (importPath.startsWith('@openzeppelin/contracts/')) {
    fullPath = path.join(__dirname, '..', 'node_modules', importPath);
  } else {
    fullPath = path.join(CONTRACTS_DIR, importPath);
  }
  try {
    return { contents: fs.readFileSync(fullPath, 'utf8') };
  } catch (err) {
    return { error: `Import not found: ${importPath} (${err.message})` };
  }
}

function main() {
  const source = fs.readFileSync(ENTRY, 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'MintHunterDemo.sol': { content: source } },
    settings: {
      optimizer: { enabled: false },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  const warnings = (output.errors || []).filter((e) => e.severity === 'warning');
  for (const w of warnings) console.log(`[compile] warning: ${w.formattedMessage}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`[compile] error: ${e.formattedMessage}`);
    process.exit(1);
  }

  const contract = output.contracts['MintHunterDemo.sol']['MintHunterDemo'];
  if (!contract) {
    console.error('[compile] MintHunterDemo not found in compiler output');
    process.exit(1);
  }

  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const artifact = {
    contractName: 'MintHunterDemo',
    sourceName: 'MintHunterDemo.sol',
    abi: contract.abi,
    bytecode: '0x' + contract.evm.bytecode.object,
    deployedBytecode: '0x' + contract.evm.deployedBytecode.object,
    metadata: contract.metadata,
    compilerVersion: solc.version(),
  };
  const outPath = path.join(BUILD_DIR, 'MintHunterDemo.json');
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));
  console.log(`[compile] wrote ${outPath}`);
  console.log(`[compile] solc ${solc.version()}`);
  console.log(`[compile] bytecode bytes: ${contract.evm.bytecode.object.length / 2}`);
  console.log(`[compile] abi entries: ${contract.abi.length}`);
}

main();
