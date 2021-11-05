//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IBZNStaking is IERC20 {
    function stake(uint256 amount) external;

    function claimFor(address staker) external virtual returns (uint256);
}