// Copyright 2021 War Riders

// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License"); you may not use
// this file except in compliance with the License. You may obtain a copy of the
// License at http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.

pragma solidity ^0.8.0;

struct vestingSchedule {
    bool isValid;               /* true if an entry exists and is valid */
    uint32 cliffDuration;       /* Duration of the cliff, with respect to the grant start day, in days. */
    uint32 duration;            /* Duration of the vesting schedule, with respect to the grant start day, in days. */
    uint32 interval;            /* Duration in days of the vesting interval. */
}

struct stakingSchedule {
    bool isActive;
    uint256 startTime;
    uint256 endTime;
    uint256 duration;
    uint256 rewardAmount;
}

struct stakingConfig {
    uint256 duration;
    bool isLinear;
    uint256 totalRewardAmount;
}

struct LiquidityLockData {
    uint256 minimum;
    uint256 maximum;
    address uniswapRouter;
    address bznAddress;
    uint256 bznSoftLimit;
    uint256 bznHardLimit;
    uint256 bznRatio;
    address bznSource; //advisor pool
    address payable recipient;
    stakingConfig staking;
    uint256 dueDate;
    uint256 startDate;
}

struct LiquidityLockConfig {
    LiquidityLockData data;
    vestingSchedule schedule;
}