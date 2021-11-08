/* eslint-disable node/no-extraneous-require */
const { BigNumber } = require("@ethersproject/bignumber");
const { assert } = require("chai");
const { config } = require("dotenv");
const { ethers, network } = require("hardhat");
const options = require("../options/deploy-options-test");

const ONE_DAY = 24 * 60 * 60;

const bn = (amount) => {
  return BigNumber.from(amount);
};

const eth = (amount) => {
  return ethers.utils.parseUnits(amount.toString(), "ether");
};

describe("Liquidity Lock", () => {
  before(async () => {
    const [multisig, deployer, user1, user2, user3, user4] =
      await ethers.getSigners();

    this.multisig = multisig;
    this.deployer = deployer;
    this.user1 = user1;
    this.user2 = user2;
    this.user3 = user3;
    this.user4 = user4;
    const newBalance = "0x8AC7230489E80000";

    const currentPoolOwner = "0x4472a4b8f2194788dbfc717811392e0aa6b30bf5";
    await network.provider.send("hardhat_setBalance", [
      currentPoolOwner,
      newBalance,
    ]);
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [currentPoolOwner],
    });
    const poolOwnerSigner = await ethers.getSigner(currentPoolOwner);

    // Transfer advisor pool to this.multisig
    const AdvisorPool = await ethers.getContractFactory(
      "AdvisorPool",
      poolOwnerSigner
    );
    const advisorPool = AdvisorPool.attach(options.data.bznSource);

    await advisorPool.transferOwnership(this.multisig.address);

    options.data.recipient = this.multisig.address;

    this.advisorPool = advisorPool;

    const latestBlock = await ethers.provider.getBlock("latest");

    if (latestBlock.number <= 8481230) {
      console.warn(
        "Current block on network is less than BZN deployment block number 8481230, deploying the BZN Token"
      );
      // If the latest block is less then the BZN creation block, then we're on a testnet
      // And we need to deploy the BZN token
      // To run the unit tests against a forked mainnet, enable SHOULD_FORK is set to true
      // in your .env file and pin either the latest block or any block after the BZN
      // deployed block on-chain

      const GamePool = await ethers.getContractFactory(
        "StandbyGamePool",
        deployer
      );
      const TeamPool = await ethers.getContractFactory("TeamPool", deployer);
      const AdvisorPool = await ethers.getContractFactory(
        "AdvisorPool",
        deployer
      );
      this.gamePool = await GamePool.deploy();
      this.teamPool = await TeamPool.deploy();
      this.advisorPool = await AdvisorPool.deploy();

      await Promise.all([
        this.gamePool.deployed(),
        this.teamPool.deployed(),
        this.advisorPool.deployed(),
      ]);

      const BZN = await ethers.getContractFactory(
        "BenzeneToken",
        this.deployer
      );
      this.bzn = await BZN.deploy(
        this.gamePool.address,
        this.teamPool.address,
        this.advisorPool.address
      );

      await this.bzn.deployed();

      options.data.recipient = this.multisig.address;
      options.data.bznSource = this.advisorPool.address;
      options.data.bznAddress = this.bzn.address;
    }
  });

  describe("Deposit", () => {
    before(async () => {
      console.log("Deploying");
      const LiquidityLock = await ethers.getContractFactory(
        "LiquidityLock",
        this.deployer
      );
      this.ll = await LiquidityLock.deploy(options);
      await this.ll.deployed();
      console.log("Deployed");
    });

    it("must fail if multisig deposit", async () => {
      try {
        await this.ll.connect(this.multisig).deposit({ value: eth(1) });

        assert(false, "transaction should have failed");
      } catch (err) {
        assert.instanceOf(err, Error);
        assert.match(err.message, /Recipient cant deposit/);
      }
    });
    it("must fail if deployer deposit", async () => {
      try {
        await this.ll.connect(this.deployer).deposit({ value: eth(1) });

        assert(false, "transaction should have failed");
      } catch (err) {
        assert.instanceOf(err, Error);
        assert.match(err.message, /Owner cant deposit/);
      }
    });
    it("must fail when user deposits no ETH", async () => {
      try {
        await this.ll.connect(this.user1).deposit({ value: eth(0) });

        assert(false, "transaction should have failed");
      } catch (err) {
        assert.instanceOf(err, Error);
        assert.match(err.message, /Must send some ether/);
      }
    });
    it("must fail when user does not deposit the minimum required ETH", async () => {
      try {
        const belowMinimum = bn(options.data.minimum)
          .sub(eth(0.001))
          .toString();
        await this.ll.connect(this.user1).deposit({
          value: belowMinimum,
        });

        assert(false, "transaction should have failed");
      } catch (err) {
        assert.instanceOf(err, Error);
        assert.match(err.message, /Must send at least the minimum/);
      }
    });
    it("must fail when user deposits over the maximum allowed ETH", async () => {
      try {
        const aboveMaximum = bn(options.data.maximum)
          .add(eth(0.001))
          .toString();

        await this.ll.connect(this.user1).deposit({
          value: aboveMaximum,
        });

        assert(false, "transaction should have failed");
      } catch (err) {
        assert.instanceOf(err, Error);
        assert.match(
          err.message,
          /Must send less than or equal to the maximum, or the maximum must be 0/
        );
      }
    });
    it("should pass when user deposits between minimum and maximum allow ETH", async () => {
      const aboveMinimum = bn(options.data.minimum).toString();

      await this.ll.connect(this.user1).deposit({ value: aboveMinimum });

      const depositAmount = (
        await this.ll.amounts(this.user1.address)
      ).toString();

      assert.equal(depositAmount, aboveMinimum);
    });
    it("should fail when user deposits between minimum and maximum but hard limit has been reached", async () => {
      let totalDepositedThusFar = await this.ll.totalAmountDeposited();
      let remaining = bn(options.data.bznHardLimit)
        .sub(totalDepositedThusFar.mul(options.data.bznRatio))
        .div(options.data.bznRatio);

      while (remaining.gt(bn(options.data.minimum))) {
        let toDeposit = remaining;
        if (toDeposit.gt(bn(options.data.maximum))) {
          toDeposit = options.data.maximum;
        }

        await this.ll.connect(this.user1).deposit({ value: toDeposit });

        totalDepositedThusFar = await this.ll.totalAmountDeposited();
        remaining = bn(options.data.bznHardLimit)
          .sub(totalDepositedThusFar.mul(options.data.bznRatio))
          .div(options.data.bznRatio);
      }

      const depositAmount = (
        await this.ll.amounts(this.user1.address)
      ).toString();

      const expectedDepositAmount = remaining
        .add(totalDepositedThusFar)
        .toString();

      assert.equal(depositAmount, expectedDepositAmount);

      try {
        await this.ll.connect(this.user2).deposit({
          value: bn(options.data.minimum),
        });

        assert(false, "transaction should have failed");
      } catch (err) {
        assert.instanceOf(err, Error);
        assert.match(err.message, /BZN Amount will exceed the hard limit/);
      }
    });
  });

  describe("Deposit -> Refund", () => {
    describe("When LiquidityLock doesn't own AdvisorPool", () => {
      before(async () => {
        const LiquidityLock = await ethers.getContractFactory(
          "LiquidityLock",
          this.deployer
        );
        this.ll = await LiquidityLock.deploy(options);
        await this.ll.deployed();
      });

      it("should pass when user 1 deposits between minimum and maximum allow ETH", async () => {
        const aboveMinimum = bn(options.data.minimum)
          .add(eth(0.001))
          .toString();

        await this.ll.connect(this.user1).deposit({ value: aboveMinimum });

        const depositAmount = (
          await this.ll.amounts(this.user1.address)
        ).toString();

        assert.equal(depositAmount, aboveMinimum);
      });

      it("should pass when user 2 deposits between minimum and maximum allow ETH", async () => {
        const aboveMinimum = bn(options.data.minimum)
          .add(eth(0.001))
          .toString();

        await this.ll.connect(this.user2).deposit({ value: aboveMinimum });

        const depositAmount = (
          await this.ll.amounts(this.user2.address)
        ).toString();

        assert.equal(depositAmount, aboveMinimum);
      });

      it("should pass when user 3 deposits between minimum and maximum allow ETH", async () => {
        const aboveMinimum = bn(options.data.minimum)
          .add(eth(0.001))
          .toString();

        await this.ll.connect(this.user3).deposit({ value: aboveMinimum });

        const depositAmount = (
          await this.ll.amounts(this.user3.address)
        ).toString();

        assert.equal(depositAmount, aboveMinimum);
      });

      it("must fail if user tries to withdrawal before refund", async () => {
        try {
          await this.ll
            .connect(this.user1)
            .refundWithdrawal(this.user1.address);

          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /Contract has not been disabled/);
        }
      });

      it("must fail when a non-owner invokes refund", async () => {
        try {
          await this.ll.connect(this.user1).refund("Testing refunds");

          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /Ownable: caller is not the owner/);
        }
      });

      it("should pass when owner invokes refund", async () => {
        await this.ll.connect(this.deployer).refund("Testing refunds");

        const disabled = await this.ll.disabled();

        assert.equal(disabled, true);
      });

      it("must fail when owner invokes refund again", async () => {
        const disabled = await this.ll.disabled();

        assert.equal(disabled, true);
        try {
          await this.ll.connect(this.deployer).refund("Testing refunds");
          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /Contract is disabled/);
        }
      });

      it("should pass if user tries to withdrawal after refund", async () => {
        await this.ll.connect(this.user1).refundWithdrawal(this.user1.address);
      });

      it("should pass if user2 tries to withdrawal on behalf of user3 after refund, giving withdrawal to user3", async () => {
        const user3BalanceBefore = await this.user3.getBalance();

        const user3DepositAmount = await this.ll.amounts(this.user3.address);
        const expected = user3BalanceBefore.add(user3DepositAmount);

        await this.ll.connect(this.user2).refundWithdrawal(this.user3.address);
        const user3BalanceAfter = await this.user3.getBalance();

        assert.equal(expected.toString(), user3BalanceAfter.toString());
      });

      it("must fail if user3 tries to withdraw again", async () => {
        const disabled = await this.ll.disabled();

        assert.equal(disabled, true);
        try {
          await this.ll
            .connect(this.user3)
            .refundWithdrawal(this.user3.address);
          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /Nothing to withdraw/);
        }
      });
    });

    describe("When LiquidityLock does own the AdvisorPool", () => {
      before(async () => {
        const LiquidityLock = await ethers.getContractFactory(
          "LiquidityLock",
          this.deployer
        );
        this.ll = await LiquidityLock.deploy(options);
        await this.ll.deployed();

        await this.advisorPool
          .connect(this.multisig)
          .transferOwnership(this.ll.address);
      });

      it("should pass when user 1 deposits between minimum and maximum allow ETH", async () => {
        const aboveMinimum = bn(options.data.minimum)
          .add(eth(0.001))
          .toString();

        await this.ll.connect(this.user1).deposit({ value: aboveMinimum });

        const depositAmount = (
          await this.ll.amounts(this.user1.address)
        ).toString();

        assert.equal(depositAmount, aboveMinimum);
      });

      it("should pass when user 2 deposits between minimum and maximum allow ETH", async () => {
        const aboveMinimum = bn(options.data.minimum)
          .add(eth(0.001))
          .toString();

        await this.ll.connect(this.user2).deposit({ value: aboveMinimum });

        const depositAmount = (
          await this.ll.amounts(this.user2.address)
        ).toString();

        assert.equal(depositAmount, aboveMinimum);
      });

      it("should pass when user 3 deposits between minimum and maximum allow ETH", async () => {
        const aboveMinimum = bn(options.data.minimum)
          .add(eth(0.001))
          .toString();

        await this.ll.connect(this.user3).deposit({ value: aboveMinimum });

        const depositAmount = (
          await this.ll.amounts(this.user3.address)
        ).toString();

        assert.equal(depositAmount, aboveMinimum);
      });

      it("must fail if user tries to withdrawal before refund", async () => {
        try {
          await this.ll
            .connect(this.user1)
            .refundWithdrawal(this.user1.address);

          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /Contract has not been disabled/);
        }
      });

      it("must fail when a non-owner invokes refund", async () => {
        try {
          await this.ll.connect(this.user1).refund("Testing refunds");

          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /Ownable: caller is not the owner/);
        }
      });

      it("should pass when owner invokes refund", async () => {
        await this.ll.connect(this.deployer).refund("Testing refunds");

        const disabled = await this.ll.disabled();

        assert.equal(disabled, true);
      });

      it("must fail when owner invokes refund again", async () => {
        const disabled = await this.ll.disabled();

        assert.equal(disabled, true);
        try {
          await this.ll.connect(this.deployer).refund("Testing refunds");
          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /Contract is disabled/);
        }
      });

      it("should pass if user tries to withdrawal after refund", async () => {
        await this.ll.connect(this.user1).refundWithdrawal(this.user1.address);
      });

      it("should pass if user2 tries to withdrawal on behalf of user3 after refund, giving withdrawal to user3", async () => {
        const user3BalanceBefore = await this.user3.getBalance();

        const user3DepositAmount = await this.ll.amounts(this.user3.address);
        const expected = user3BalanceBefore.add(user3DepositAmount);

        await this.ll.connect(this.user2).refundWithdrawal(this.user3.address);
        const user3BalanceAfter = await this.user3.getBalance();

        assert.equal(expected.toString(), user3BalanceAfter.toString());
      });

      it("must fail if user3 tries to withdraw again", async () => {
        const disabled = await this.ll.disabled();

        assert.equal(disabled, true);
        try {
          await this.ll
            .connect(this.user3)
            .refundWithdrawal(this.user3.address);
          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /Nothing to withdraw/);
        }
      });
    });
  });

  describe("Deposit -> Execute", () => {
    describe("When LiquidityLock doesn't own AdvisorPool", () => {
      before(async () => {
        const LiquidityLock = await ethers.getContractFactory(
          "LiquidityLock",
          this.deployer
        );

        const date = new Date();
        date.setDate(date.getDate() + 1);

        options.data.dueDate = date.getTime();

        this.ll = await LiquidityLock.deploy(options);
        await this.ll.deployed();
      });

      it("must fail to execute if non-owner invokes execute", async () => {
        try {
          await this.ll.connect(this.user1).execute();

          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /Ownable: caller is not the owner/);
        }
      });

      it("must fail to execute if owner invokes execute with no deposits", async () => {
        try {
          await this.ll.connect(this.deployer).execute();

          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /No deposits/);
        }
      });

      it("should pass when user 1 deposits between minimum and maximum allow ETH", async () => {
        const aboveMinimum = bn(options.data.minimum)
          .add(eth(0.001))
          .toString();

        await this.ll.connect(this.user1).deposit({ value: aboveMinimum });

        const depositAmount = (
          await this.ll.amounts(this.user1.address)
        ).toString();

        assert.equal(depositAmount, aboveMinimum);
      });

      it("should pass when user 2 deposits between minimum and maximum allow ETH", async () => {
        const aboveMinimum = bn(options.data.minimum)
          .add(eth(0.001))
          .toString();

        await this.ll.connect(this.user2).deposit({ value: aboveMinimum });

        const depositAmount = (
          await this.ll.amounts(this.user2.address)
        ).toString();

        assert.equal(depositAmount, aboveMinimum);
      });

      it("should pass when user 3 deposits between minimum and maximum allow ETH", async () => {
        const aboveMinimum = bn(options.data.minimum)
          .add(eth(0.001))
          .toString();

        await this.ll.connect(this.user3).deposit({ value: aboveMinimum });

        const depositAmount = (
          await this.ll.amounts(this.user3.address)
        ).toString();

        assert.equal(depositAmount, aboveMinimum);
      });

      it("must fail when LiquidityLock doesn't own AdvisorPool when owner invokes execute", async () => {
        try {
          await this.ll.connect(this.deployer).execute();

          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /LiquidityLocking must own Advisor Pool/);
        }
      });
    });

    describe("When LiquidityLock does own AdvisorPool", () => {
      before(async () => {
        const LiquidityLock = await ethers.getContractFactory(
          "LiquidityLock",
          this.deployer
        );

        const date = new Date();
        date.setDate(date.getDate() + 1);

        options.data.dueDate = date.getTime();

        this.ll = await LiquidityLock.deploy(options);
        await this.ll.deployed();

        await this.advisorPool
          .connect(this.multisig)
          .transferOwnership(this.ll.address);
      });
      it("must fail to execute if non-owner invokes execute", async () => {
        try {
          await this.ll.connect(this.user1).execute();

          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /Ownable: caller is not the owner/);
        }
      });

      it("must fail to execute if owner invokes execute with no deposits", async () => {
        try {
          await this.ll.connect(this.deployer).execute();

          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /No deposits/);
        }
      });

      it("must fail if user1 tries to setup before execution", async () => {
        try {
          await this.ll.connect(this.user1).setup(this.user1.address);
          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /The execute\(\) function hasn't run yet/);
        }
      });

      it("should pass when user 1 deposits between minimum and maximum allow ETH", async () => {
        const aboveMinimum = bn(options.data.minimum)
          .add(eth(0.001))
          .toString();

        await this.ll.connect(this.user1).deposit({ value: aboveMinimum });

        const depositAmount = (
          await this.ll.amounts(this.user1.address)
        ).toString();

        assert.equal(depositAmount, aboveMinimum);
      });

      it("must fail when soft limit hasn't been reached when owner invokes execute", async () => {
        try {
          await this.ll.connect(this.deployer).execute();

          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(
            err.message,
            /BZN Amount must be at least the soft limit/
          );
        }
      });

      it("should pass when user 2 deposits between minimum and maximum allow ETH", async () => {
        const aboveMinimum = bn(options.data.minimum)
          .add(eth(0.001))
          .toString();

        await this.ll.connect(this.user2).deposit({ value: aboveMinimum });

        const depositAmount = (
          await this.ll.amounts(this.user2.address)
        ).toString();

        assert.equal(depositAmount, aboveMinimum);
      });

      it("should pass when user 3 deposits between minimum and maximum allow ETH", async () => {
        const aboveMinimum = bn(options.data.minimum).add(eth(1)).toString();

        await this.ll.connect(this.user3).deposit({ value: aboveMinimum });

        const depositAmount = (
          await this.ll.amounts(this.user3.address)
        ).toString();

        assert.equal(depositAmount, aboveMinimum);
      });

      it("should execute when soft limit has been reached", async () => {
        await this.ll.connect(this.deployer).execute();

        const executed = await this.ll.executed();

        assert.equal(executed, true);
      });

      it("should pass if user1 tries to setup their vesting/staking", async () => {
        await this.ll.connect(this.user1).setup(this.user1.address);

        const user1Setup = (await this.ll.userData(this.user1.address))
          .isActive;

        assert.equal(user1Setup, true);
      });

      it("should pass if user2 tries to setup vesting/staking on behalf of user3, setting up data for user3", async () => {
        const user3SetupBefore = (await this.ll.userData(this.user3.address))
          .isActive;
        const user2SetupBefore = (await this.ll.userData(this.user2.address))
          .isActive;

        assert.equal(user3SetupBefore, false);
        assert.equal(user2SetupBefore, false);

        await this.ll.connect(this.user2).setup(this.user3.address);
        const user3SetupAfter = (await this.ll.userData(this.user3.address))
          .isActive;
        const user2SetupAfter = (await this.ll.userData(this.user2.address))
          .isActive;

        assert.equal(user3SetupAfter, true);
        assert.equal(user2SetupAfter, false);
      });

      it("should pass if user2 tries to setup their vesting/staking", async () => {
        await this.ll.connect(this.user2).setup(this.user2.address);
      });

      it("must fail if user3 tries to setup again", async () => {
        try {
          await this.ll.connect(this.user3).setup(this.user3.address);
          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /Setup already called for this address/);
        }
      });

      it("must fail if user4 tries to setup, they did not deposit", async () => {
        try {
          await this.ll.connect(this.user4).setup(this.user4.address);
          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(
            err.message,
            /The depositor address provided didn't make any deposit/
          );
        }
      });

      it("must fail if user1 tries to redeem LP tokens before the cliff period", async () => {
        try {
          await this.ll.connect(this.user1).redeemLPTokens(this.user1.address);
          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /No tokens vested yet/);
        }
      });

      it("must fail if user4 tries to redeem LP tokens before the cliff period", async () => {
        try {
          await this.ll.connect(this.user4).redeemLPTokens(this.user4.address);
          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /Address has no tokens to redeem/);
        }
      });

      it("must fail if user1 tries to redeem BZN tokens before the cliff period", async () => {
        const extraBznAmount = (
          await this.ll._bznTokenGrants(this.user1.address)
        ).amount;

        if (bn(extraBznAmount).eq(bn(0))) {
          return;
        }

        try {
          await this.ll.connect(this.user1).redeemExtraBZN(this.user1.address);
          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /No tokens vested yet/);
        }
      });

      it("must fail if user4 tries to redeem BZN tokens before the cliff period", async () => {
        try {
          await this.ll.connect(this.user4).redeemExtraBZN(this.user4.address);
          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /Address has no tokens to redeem/);
        }
      });

      it("must fail if user1 tries to redeem reward tokens before the cliff period", async () => {
        const extraBznAmount = (
          await this.ll._bznTokenGrants(this.user1.address)
        ).amount;

        if (bn(extraBznAmount).eq(bn(0))) {
          return;
        }

        try {
          await this.ll.connect(this.user1).redeemExtraBZN(this.user1.address);
          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /No tokens vested yet/);
        }
      });

      it("must fail if user4 tries to redeem reward tokens, they did not deposit", async () => {
        try {
          await this.ll.connect(this.user4).redeemExtraBZN(this.user4.address);
          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /Address has no tokens to redeem/);
        }
      });

      it("should pass if user2 tries to unstake LP tokens after cliff period", async () => {
        await network.provider.send("evm_increaseTime", [
          ONE_DAY * (options.schedule.cliffDuration + 1),
        ]);
        await network.provider.send("evm_mine");

        await this.ll.connect(this.user2).redeemLPTokens(this.user2.address);
      });

      it("should pass if user2 tries to redeem BZN tokens after cliff period", async () => {
        const extraBznAmount = (
          await this.ll._bznTokenGrants(this.user1.address)
        ).amount;

        if (bn(extraBznAmount).eq(bn(0))) {
          return;
        }

        await this.ll.connect(this.user2).redeemExtraBZN(this.user2.address);
      });

      it("should pass if user1 tries to claim rewards tokens after cliff period", async () => {
        await this.ll.connect(this.user1).claimFor(this.user1.address);
      });

      it("should pass if user1 tries to unstake LP tokens after cliff period", async () => {
        await this.ll.connect(this.user1).redeemLPTokens(this.user1.address);
      });

      it("must fail if user1 tries to unstake LP tokens, they've already unstaked LP tokens today", async () => {
        try {
          await this.ll.connect(this.user1).redeemLPTokens(this.user1.address);
          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /No tokens vested yet/);
        }
      });

      it("should pass if user1 tries to unstake LP tokens after waiting one day", async () => {
        await network.provider.send("evm_increaseTime", [ONE_DAY]);
        await network.provider.send("evm_mine");

        await this.ll.connect(this.user1).redeemLPTokens(this.user1.address);
      });

      it("should pass if user1 tries to unstake all LP tokens after waiting the rest of the duration", async () => {
        await network.provider.send("evm_increaseTime", [ONE_DAY * 338]);
        await network.provider.send("evm_mine");

        await this.ll.connect(this.user1).redeemLPTokens(this.user1.address);
      });

      it("must fail if user1 tries to unstake LP tokens, they've already unstaked all LP tokens", async () => {
        try {
          await this.ll.connect(this.user1).redeemLPTokens(this.user1.address);
          assert(false, "transaction should have failed");
        } catch (err) {
          assert.instanceOf(err, Error);
          assert.match(err.message, /No LP Tokens to redeem/);
        }
      });
    });
  });
});
