//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface ETHFeed {
    function priceForEtherInUsdWei() external view returns (uint256);
}