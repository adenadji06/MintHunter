// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MintHunter Demo — a minimal free-mint ERC-721 for the NEAR Hackathon demo.
/// @notice One free mint per wallet. No fee, no owner withdraw of user funds,
/// no selfdestruct, no delegatecall, no token sweep. The owner is the
/// deployer (used by MintHunter's verifier to check the deployer is not
/// excluded) and has no way to take user funds: there is no withdraw
/// function at all. Deployed on BSC testnet (chain 97) only.
/// @dev Compiled with solc 0.8.38 + OpenZeppelin Contracts 5.0.2.
///      See contracts/compile.js for the reproducible build.
contract MintHunterDemo is ERC721, Ownable {
    uint256 public constant MAX_SUPPLY = 1000;
    uint256 public totalMinted;

    mapping(address => bool) public hasMinted;

    constructor() ERC721("MintHunter Demo", "MHD") Ownable(msg.sender) {}

    /// @notice Mint one free NFT. One per wallet, no payment required.
    function mintFree() external {
        require(!hasMinted[msg.sender], "MintHunterDemo: already minted");
        require(totalMinted < MAX_SUPPLY, "MintHunterDemo: sold out");
        hasMinted[msg.sender] = true;
        totalMinted += 1;
        _safeMint(msg.sender, totalMinted);
    }

    /// @notice Number of NFTs minted so far.
    function totalSupply() external view returns (uint256) {
        return totalMinted;
    }
}
