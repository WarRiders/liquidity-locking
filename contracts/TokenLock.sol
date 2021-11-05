//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TokenLock is Ownable {

    function balanceOfToken(address tokenAddress) external view returns (uint256) {
        IERC20 token = IERC20(tokenAddress);
        return token.balanceOf(address(this));
    }

    function approveToken(address tokenAddress, uint256 amount, address spender) external onlyOwner {
        IERC20 token = IERC20(tokenAddress);

        token.approve(spender, amount);
    }
}
