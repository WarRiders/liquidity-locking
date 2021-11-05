//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IAdvisorPool {
    function owner() external view returns (address);

    function transferOwnership(address newOwner) external;

    function transfer(address _beneficiary, uint256 amount) external returns (bool);

    function balance() external view returns (uint256);
}