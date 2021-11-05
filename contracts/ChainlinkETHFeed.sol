//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./ETHFeed.sol";
import "./AggregatorInterface.sol";

contract ChainlinkETHFeed is ETHFeed {
    address public aggregator;

    constructor(address _aggregator) {
        aggregator = _aggregator;
    }

    function priceForEtherInUsdWei() external override view returns (uint256) {
        AggregatorInterface agg = AggregatorInterface(aggregator);
        uint256 currentPrice = uint256(agg.latestAnswer());
        uint256 decimals = agg.decimals();

        if (decimals == 18) {
            return currentPrice;
        } else if (decimals < 18) {
            //Convert price to wei
            uint256 factor = 10 ** (18 - decimals);
            uint256 convertedPrice = currentPrice * factor;

            return convertedPrice;
        } else {
            revert("Feed is using unsupported decimals");
        }
    }
}