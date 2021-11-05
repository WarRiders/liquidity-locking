//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./ETHFeed.sol";
import "./LiquidityLockConfig.sol";
import "./IUniswapV2Router02.sol";
import "./IUniswapV2Factory.sol";
import "./IAdvisorPool.sol";
import "./IUniswapV2Pair.sol";
import "hardhat/console.sol";

contract LiquidityLock is Ownable {

    // Date-related constants for sanity-checking dates to reject obvious erroneous inputs
    // and conversions from seconds to days and years that are more or less leap year-aware.
    uint32 private constant SECONDS_PER_DAY = 24 * 60 * 60;                 /* 86400 seconds in a day */

    uint8 private constant MAX_FAIL_AMOUNT = 3;

    // Event Data

    // Emitted when a staked user are given their rewards
    event RewardPaid(address indexed user, uint256 reward);

    // Emitted when the execute() function is called
    event Locked(uint256 bznPrice, uint256 weiTotal, uint256 lpTokenTotal, uint256 bznExtra);

    // Emitted when a user deposits Eth
    event Deposit(address indexed user, uint256 amount);

    // Emitted when a user deposits Eth
    event Withdraw(address indexed user, uint256 amount);

    // Emitted when a user redeems either the LP Token or the Extra BZN
    event RedeemedToken(address indexed user, address indexed token, uint256 amount);

    // Emitted when the contract gets disabled and funds are refunded
    event Disabled(string reason);

    // Set to true when the execute() is called
    // deposit() only works when executed = false
    // Redeem functions only work when executed = true
    bool public executed;

    // General config data
    LiquidityLockData public config;
    
    bool public disabled;
    bool public refundWithdrawalRequired;

    uint256 public totalRewardsClaimed;

    //total amount
    uint256 public totalAmountDeposited;
    // deposit data
    mapping(address => uint256) public amounts;
    // All users who have deposited
    address[] public depositors;
    mapping(address => uint256) internal depositorIndexed;

    // locking data
    struct UserLockingData {
        bool isActive;
        address user;
        uint256 lockStartTime;
        uint256 lpTokenTotal;
        uint256 bznExtraTotal;
    }
    // Locking data for each user
    mapping(address => UserLockingData) public userData;

    // Token Vesting Grant data
    struct tokenGrant {
        bool isActive;              /* true if this vesting entry is active and in-effect entry. */
        uint32 startDay;            /* Start day of the grant, in days since the UNIX epoch (start of day). */
        uint256 amount;             /* Total number of tokens that vest. */
    }

    // Global vesting schedule
    vestingSchedule public _tokenVestingSchedule;
    // Token Vesting grants for each user for LP Tokens
    mapping(address => tokenGrant) public _lpTokenGrants;
    // Token Vesting grants for each user for BZN Tokens
    mapping(address => tokenGrant) public _bznTokenGrants;

    IERC20 lpToken;

    // staking data
    IERC20 internal immutable _rewardToken;
    // staking schedule data
    stakingSchedule public _tokenStakingSchedule;

    uint256 public totalLiquidityAmount;
    uint256 public totalExtraBznAmount;
    uint256 internal totalBalanceAtExecute;
    uint256 public executedTimestamp;
    uint32 public executedDay;

    // The last timestamp a user claimed rewards
    mapping(address => uint256) public _lastClaimTime;
    // The amount of rewards a user has claimed
    mapping(address => uint256) public amountClaimed;

    constructor(LiquidityLockConfig memory _config) {
        _tokenVestingSchedule = _config.schedule;
        _tokenStakingSchedule = stakingSchedule(false, 0, 0, 0, 0);

        config = _config.data;

        _rewardToken = IERC20(config.bznAddress);
    }

    modifier isActive {
        require(!disabled, "Contract is disabled");
        require(!executed, "No longer active");
        _;
    }

    modifier hasExecuted {
        require(!disabled, "Contract is disabled");
        require(executed, "Waiting for execute");
        _;
    }

    modifier isStakingActive {
        require(!disabled, "Contract is disabled");
        require(_tokenStakingSchedule.isActive, "Staking is not active");
        _;
    }

    receive() external payable { }

    /**
    * @dev Lets a user deposit ETH to participate in LiquidityLocking. The amount of
    * ETH sent must meet the minimum USD price set
    * Can only be invoked before the execute() function is called by the owner
    */
    function deposit() public payable isActive {
        require(msg.value > 0, "Must send some ether");
        require(msg.sender != config.recipient, "Recipient cant deposit");
        require(msg.sender != owner(), "Owner cant deposit");

        require(msg.value >= config.minimum, "Must send at least the minimum");
        require(msg.value <= config.maximum || config.maximum == 0, "Must send less than or equal to the maximum, or the maximum must be 0");
        uint256 currentBalance = totalAmountDeposited + msg.value;
        uint256 bznAmount = currentBalance * config.bznRatio;
        require(bznAmount <= config.bznHardLimit, "BZN Amount will exceed the hard limit");

        if (amounts[msg.sender] == 0) {
            depositors.push(msg.sender);
        }

        amounts[msg.sender] += msg.value;
        totalAmountDeposited += msg.value;

        emit Deposit(msg.sender, msg.value);
    }

    // calculate price based on pair reserves
    function getTokenPrice(address pairAddress, uint amount) public view returns(uint)
    {
        IUniswapV2Pair pair = IUniswapV2Pair(pairAddress);
        IERC20Metadata token1 = IERC20Metadata(pair.token1());
        IERC20Metadata token2 = IERC20Metadata(pair.token0());

        console.log("Token1 is %s", token1.name());

        (uint Res0, uint Res1,) = pair.getReserves();

        // decimals
        uint res0 = Res0*(10**token1.decimals());
        return((amount*res0)/Res1) / (10**token2.decimals()); // return amount of token0 needed to buy token1
    }

    /**
    * @dev Execute the LiquidityLock, locking all deposited Eth
    * in the Uniswap v2 Liquidity Pool for ETH/BZN
    * 
    * The LP Tokens retrieved will be distributed to each user proportional 
    * depending on how much each user has deposited. The LP Tokens will then be staked
    * and vested, so the user may only redeem their LP tokens after a certain cliff period
    * and linearly depending on the vesting schedule. If a user chooses to keep their 
    * LP tokens locked in this contract, then they will earn staking rewards
    *
    * Any extra BZN that did not make it into the Liquidity pool will also be 
    * distributed to each user proportionally depending on how much each user has deposited. The
    * extra BZN will also be vested using the same vesting schedule as the LP Tokens, but they will
    * not earn staking rewards
    */
    function execute() external onlyOwner isActive {
        require(!disabled, "This contract has been disabled");
        
        uint256 currentBalance = totalAmountDeposited;
        uint256 bznAmount = currentBalance * config.bznRatio;

        require(currentBalance > 0, "No deposits");

        if (block.timestamp > config.dueDate && bznAmount < config.bznSoftLimit) {
            refund("Due date passed");
            return;
        }

        //First we need to grab all of the BZN and bring it here
        IERC20 bzn = IERC20(config.bznAddress);
        IAdvisorPool pool = IAdvisorPool(config.bznSource);

        require(pool.owner() == address(this), "LiquidityLocking must own Advisor Pool");

        uint256 realCurrentBalance = address(this).balance;
        require(realCurrentBalance >= totalAmountDeposited, "Recorded amount deposited is less than actual balance");

        uint256 weiTotal = currentBalance / 2;
        uint256 recipientAmount = currentBalance - weiTotal;

        require(bznAmount >= config.bznSoftLimit, "BZN Amount must be at least the soft limit");
        require(bznAmount < config.bznHardLimit, "BZN Amount exceeds the hard limit");

        //Now transfer the amount we need from the Advisor pool to us
        pool.transfer(address(this), bznAmount);

        //Create new scope to avoid "stack too deep" compile errors
        {
            IUniswapV2Router02 uniswap = IUniswapV2Router02(config.uniswapRouter);

            address weth = uniswap.WETH();
            
            lpToken = IERC20(IUniswapV2Factory(uniswap.factory()).getPair(config.bznAddress, weth));

            require(address(lpToken) != address(0), "BZN/ETH Pool doesn't exist");

            uint amountToken; uint amountETH; 

            //Now we to figure out how much BZN[wei] we are putting up per ETH[wei]
            uint256 amountETHDesired = weiTotal;
            uint256 amountTokenDesired = getTokenPrice(address(lpToken), amountETHDesired);
            
            //This is 1%
            uint256 amountTokenMin = amountTokenDesired - ((amountTokenDesired * 100) / 10000);
            uint256 amountETHMin = amountETHDesired - ((amountETHDesired * 100) / 10000);

            bzn.approve(config.uniswapRouter, amountTokenDesired);

            console.log("Adding %d ETH and %d BZN to Uniswap Pool", amountETHDesired, amountTokenDesired);

            (amountToken, amountETH, totalLiquidityAmount) = uniswap.addLiquidityETH{value:amountETHDesired}(config.bznAddress, amountTokenDesired, amountTokenMin, amountETHMin, address(this), block.timestamp);
            totalExtraBznAmount = bznAmount - amountToken;
        }

        totalBalanceAtExecute = currentBalance;
        executedTimestamp = block.timestamp;
        executedDay = today();

        //Transfer the reward amount to us
        _tokenStakingSchedule.rewardAmount = config.staking.totalRewardAmount;
        pool.transfer(address(this), config.staking.totalRewardAmount);
        beginRewardPeriod(config.staking.duration);

        executed = true;

        config.recipient.transfer(recipientAmount);
        pool.transferOwnership(config.recipient);

        emit Locked(config.bznRatio, weiTotal, totalLiquidityAmount, totalExtraBznAmount);
    }

    function isDisabled() public view returns (bool) {
        uint256 currentBalance = totalAmountDeposited;
        uint256 bznAmount = currentBalance * config.bznRatio;

        return disabled || (block.timestamp > config.dueDate && bznAmount < config.bznSoftLimit);
    }

    /**
    * @dev Allows to disable this contract and refund all users who made a deposit their total deposit.
    * Use this if the contract state is broken or a new revision is required. This must be invoked
    * before execute(). This cannot be invoke after execute()
    * @param reason A reason for the refund to record on-chain
    */
    function refund(string memory reason) public onlyOwner isActive {
        require(!disabled, "Refund already called");

        disabled = true;

        IAdvisorPool pool = IAdvisorPool(config.bznSource);
        if (pool.owner() == address(this)) {
            pool.transferOwnership(config.recipient);
        }

        emit Disabled(reason);
    }

    /**
    * @dev To be used after emergencyShutdown(string) is invoked. Allows users to withdrawal
    * their funds in the event of an emergency refund
    * @param user The user requesting the refund withdrawal
    */
    function refundWithdrawal(address payable user) external {
        require(disabled, "Contract has not been disabled");
        require(amounts[user] > 0, "Nothing to withdraw");

        uint256 userAmount = amounts[user];

        amounts[user] = 0;

        user.transfer(userAmount);
    }

    /**
    * @dev Depositors must invoke this function after execute() has been invoked. This will
    * setup their vesting/staking of LP Tokens and Extra BZN. Anyone can run this function
    * on-behalf of the depositor
    * @param depositor The depositor address to setup vesting/staking for
    */
    function setup(address depositor) external {
        require(executed, "The execute() function hasn't run yet");

        uint256 userAmount = amounts[depositor];

        require(userAmount > 0, "The depositor address provided didn't make any deposit");

        uint256 lpTokenAmount = (totalLiquidityAmount * userAmount) / totalBalanceAtExecute;
        uint256 bznAmount = (totalExtraBznAmount * userAmount) / totalBalanceAtExecute;

        userData[depositor] = UserLockingData(
            true,
            depositor,
            executedTimestamp,
            lpTokenAmount,
            bznAmount
        );

        _lpTokenGrants[depositor] = tokenGrant(
            true/*isActive*/,
            executedDay,
            lpTokenAmount
        );

        _bznTokenGrants[depositor] = tokenGrant(
            true,
            executedDay,
            bznAmount
        );
    }

    /**
    * @dev Start the staking reward period. Only invoked inside execute()
    * @param _duration The length of the staking period
    */
    function beginRewardPeriod(uint256 _duration) internal {
        _tokenStakingSchedule.duration = _duration;
        _tokenStakingSchedule.startTime = block.timestamp;

        _tokenStakingSchedule.endTime = _tokenStakingSchedule.startTime + _tokenStakingSchedule.duration;

        _tokenStakingSchedule.isActive = true;
    }

    /**
    * @dev The current total amount of LP Tokens being staked
    * @return The total amount of LP Tokens being staked
    */
    function totalStaking() public virtual view returns (uint256) {
        return lpToken.balanceOf(address(this));
    }

    /**
    * @dev The current amount of LP Tokens an owner is staking
    * @param account The account to check
    * @return The total amount of LP Tokens being staked by an account
    */
    function stakingOf(address account) public virtual view returns (uint256) {
        return userData[account].lpTokenTotal;
    }

    /**
    * @dev The current amount of rewards in the reward pool
    * @return The total amount of rewards left in the reward pool
    */
    function totalRewardPool() public virtual view returns (uint256) {
        return _tokenStakingSchedule.rewardAmount;
    }

    /**
    * @dev Get the current amount of rewards earned by an owner
    * @param owner The owner to check
    * @return The current amount of rewards earned thus far
    */
    function rewardAmountFor(address owner) public view isStakingActive returns (uint256) {
        if (totalStaking() == 0)
            return 0;

        //Use original amount of reward pool to calculate portion
        uint256 amount = totalRewardPool() + totalRewardsClaimed;
        uint256 stakeAmount = stakingOf(owner);

        //Calculate portion of original reward pool amount owner gets
        amount = (amount * stakeAmount) / totalStaking();

        //If they've claimed everything
        if (amountClaimed[owner] >= amount) {
            return 0; //Nothing else left to claim
        }

        //Remove any BZN they've already claimed
        amount = amount - amountClaimed[owner];

        uint256 lastRewardClaimTime = _lastClaimTime[owner];

        if (lastRewardClaimTime == 0) {
            //Set last claim time to be the time where reward period started
            lastRewardClaimTime = _tokenStakingSchedule.startTime;
        }

        if (_tokenStakingSchedule.endTime == 0) {
            return 0; //Staking hasn't started yet
        }

        if (block.timestamp < _tokenStakingSchedule.endTime) {
            amount = (amount * (block.timestamp - lastRewardClaimTime)) / (_tokenStakingSchedule.endTime - lastRewardClaimTime);
        } else if (lastRewardClaimTime >= _tokenStakingSchedule.endTime) {
            //Final check to make sure they don't claim again after period ends
            amount = 0;
        }
        
        return amount;
    }

    /**
    * @dev Claim staking rewards on behalf of an owner. This will not unstake any LP Tokens.
    * Staking rewards will be transferred to the owner, regardless of who invokes
    * the function (allows for meta transactions)
    * @param owner The owner to claim staking rewards for
    */
    function claimFor(address owner) public virtual isStakingActive returns (uint256) {
        uint256 amount = rewardAmountFor(owner);
        
        if (amount > 0) {
            _lastClaimTime[owner] = block.timestamp;
            amountClaimed[owner] = amountClaimed[owner] + amount;
            totalRewardsClaimed += amount;
            
            _tokenStakingSchedule.rewardAmount -= amount;
            _rewardToken.transfer(owner, amount);
            
            emit RewardPaid(owner, amount);
        }
        
        return amount;
    }

    /**
    * @dev Redeem any vested LP Tokens and claim any rewards the staked LP
    * tokens have earned on behalf of an owner. The vested LP Tokens 
    * and staking rewards will be transferred to the owner regardless of who invokes
    * the function (allows for meta transactions)
    * @param owner The owner of the vested LP Tokens
    */
    function redeemLPTokens(address owner) external hasExecuted {
        require(userData[owner].isActive, "Address has no tokens to redeem");
        require(userData[owner].lpTokenTotal > 0, "No LP Tokens to redeem");

        uint256 vestedAmount = getAvailableLPAmount(owner, today());

        require(vestedAmount > 0, "No tokens vested yet");

        //First give them the rewards they've collected thus far
        claimFor(owner);

        //Then decrement the amount of tokens they have
        userData[owner].lpTokenTotal -= vestedAmount;

        //Then transfer the LP tokens
        lpToken.transfer(owner, vestedAmount);
    }

    /**
    * @dev Redeem extra BZN on the behalf of an owner. This will redeem any
    * vested BZN and transfer it back to the owner regardless of who invokes
    * the function (allows for meta transactions)
    * @param owner The owner of the vested BZN
    */
    function redeemExtraBZN(address owner) external hasExecuted {
        require(userData[owner].isActive, "Address has no tokens to redeem");
        require(userData[owner].bznExtraTotal > 0, "No BZN Tokens to redeem");

        uint256 vestedAmount = getAvailableBZNAmount(owner, today());

        require(vestedAmount > 0, "No tokens vested yet");

        //Decrement the amount of tokens they have
        userData[owner].bznExtraTotal -= vestedAmount;

        //Then transfer the LP tokens
        IERC20 bznTokens = IERC20(config.bznAddress);
        bznTokens.transfer(owner, vestedAmount);
    }

    /**
    * @dev Get the address of the LP Token
    */
    function getLPTokenAddress() public view returns (address) {
        return address(lpToken);
    }

    /**
     * @dev returns true if the account has sufficient funds available to cover the given amount,
     *   including consideration for vesting tokens.
     *
     * @param account = The account to check.
     * @param amount = The required amount of vested funds.
     * @param onDay = The day to check for, in days since the UNIX epoch.
     */
    function _LPAreAvailableOn(address account, uint256 amount, uint32 onDay) internal view returns (bool ok) {
        return (amount <= getAvailableLPAmount(account, onDay));
    }

    /**
     * @dev Computes the amount of funds in the given account which are available for use as of
     * the given day. If there's no vesting schedule then 0 tokens are considered to be vested and
     * this just returns the full account balance.
     *
     * The math is: available amount = total funds - notVestedAmount.
     *
     * @param grantHolder = The account to check.
     * @param onDay = The day to check for, in days since the UNIX epoch.
     */
    function getAvailableBZNAmount(address grantHolder, uint32 onDay) internal view returns (uint256 amountAvailable) {
        uint256 totalTokens = userData[grantHolder].bznExtraTotal;
        uint256 vested = totalTokens - _getNotVestedAmount(grantHolder, onDay, _bznTokenGrants[grantHolder]);
        return vested;
    }

     /**
     * @dev Computes the amount of funds in the given account which are available for use as of
     * the given day. If there's no vesting schedule then 0 tokens are considered to be vested and
     * this just returns the full account balance.
     *
     * The math is: available amount = total funds - notVestedAmount.
     *
     * @param grantHolder = The account to check.
     * @param onDay = The day to check for, in days since the UNIX epoch.
     */
    function getAvailableLPAmount(address grantHolder, uint32 onDay) internal view returns (uint256 amountAvailable) {
        uint256 totalTokens = userData[grantHolder].lpTokenTotal;
        uint256 vested = totalTokens - _getNotVestedAmount(grantHolder, onDay, _lpTokenGrants[grantHolder]);
        return vested;
    }

    /**
     * @dev returns the day number of the current day, in days since the UNIX epoch.
     */
    function today() public view returns (uint32 dayNumber) {
        return uint32(block.timestamp / SECONDS_PER_DAY);
    }

    function _effectiveDay(uint32 onDayOrToday) internal view returns (uint32 dayNumber) {
        return onDayOrToday == 0 ? today() : onDayOrToday;
    }

    /**
     * @dev Determines the amount of tokens that have not vested in the given account.
     *
     * The math is: not vested amount = vesting amount * (end date - on date)/(end date - start date)
     *
     * @param grantHolder = The account to check.
     * @param onDayOrToday = The day to check for, in days since the UNIX epoch. Can pass
     *   the special value 0 to indicate today.
     */
    function _getNotVestedAmount(address grantHolder, uint32 onDayOrToday, tokenGrant memory grant) internal view returns (uint256 amountNotVested) {
        uint32 onDay = _effectiveDay(onDayOrToday);

        // If there's no schedule, or before the vesting cliff, then the full amount is not vested.
        if (!grant.isActive || onDay < grant.startDay + _tokenVestingSchedule.cliffDuration)
        {
            // None are vested (all are not vested)
            return grant.amount;
        }
        // If after end of vesting, then the not vested amount is zero (all are vested).
        else if (onDay >= grant.startDay + _tokenVestingSchedule.duration)
        {
            // All are vested (none are not vested)
            return uint256(0);
        }
        // Otherwise a fractional amount is vested.
        else
        {
            // Compute the exact number of days vested.
            uint32 daysVested = onDay - grant.startDay;
            // Adjust result rounding down to take into consideration the interval.
            uint32 effectiveDaysVested = (daysVested / _tokenVestingSchedule.interval) * _tokenVestingSchedule.interval;

            // Compute the fraction vested from schedule using 224.32 fixed point math for date range ratio.
            // Note: This is safe in 256-bit math because max value of X billion tokens = X*10^27 wei, and
            // typical token amounts can fit into 90 bits. Scaling using a 32 bits value results in only 125
            // bits before reducing back to 90 bits by dividing. There is plenty of room left, even for token
            // amounts many orders of magnitude greater than mere billions.
            uint256 vested = (grant.amount * effectiveDaysVested) / _tokenVestingSchedule.duration;
            return grant.amount - vested;
        }
    }
}