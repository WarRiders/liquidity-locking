/* eslint-disable node/no-extraneous-require */
const { BigNumber } = require("@ethersproject/bignumber");
const { assert } = require("chai");
const { ethers } = require("hardhat");
const options = require("../options/deploy-options-rinkeby");

const bn = (amount) => {
  return BigNumber.from(amount);
};

const eth = (amount) => {
  return ethers.utils.parseUnits(amount.toString(), "ether");
};

describe("Liquidity Lock", () => {
  before(async () => {
    const [multisig, deployer, user1, user2, user3] = await ethers.getSigners();

    this.multisig = multisig;
    this.deployer = deployer;
    this.user1 = user1;
    this.user2 = user2;
    this.user3 = user3;

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

    const BZN = await ethers.getContractFactory("BenzeneToken", this.deployer);
    this.bzn = await BZN.deploy(
      this.gamePool.address,
      this.teamPool.address,
      this.advisorPool.address
    );

    await this.bzn.deployed();

    options.data.recipient = this.multisig.address;
    options.data.bznSource = this.advisorPool.address;
    options.data.bznAddress = this.bzn.address;
  });

  describe("Deposit", () => {
    before(async () => {
      const LiquidityLock = await ethers.getContractFactory(
        "LiquidityLock",
        this.deployer
      );
      this.ll = await LiquidityLock.deploy(options);
      await this.ll.deployed();
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
      const aboveMinimum = bn(options.data.minimum).add(eth(0.001)).toString();

      await this.ll.connect(this.user1).deposit({ value: aboveMinimum });

      const depositAmount = (
        await this.ll.amounts(this.user1.address)
      ).toString();

      assert.equal(depositAmount, aboveMinimum);
    });
    it("should fail when user deposits between minimum and maximum but hard limit has been reached", async () => {
      const totalDepositedThusFar = await this.ll.totalAmountDeposited();
      const remaining = bn(options.data.bznHardLimit)
        .sub(totalDepositedThusFar.mul(options.data.bznRatio))
        .div(options.data.bznRatio);

      await this.ll.connect(this.user1).deposit({ value: remaining });

      const depositAmount = (
        await this.ll.amounts(this.user1.address)
      ).toString();

      const expectedDepositAmount = remaining
        .add(totalDepositedThusFar)
        .toString();

      assert.equal(depositAmount, expectedDepositAmount);

      try {
        await this.ll.connect(this.user2).deposit({
          value: remaining,
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
          .connect(this.deployer)
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
        const aboveMinimum = bn(options.data.minimum)
          .add(eth(0.001))
          .toString();

        await this.ll.connect(this.user3).deposit({ value: aboveMinimum });

        const depositAmount = (
          await this.ll.amounts(this.user3.address)
        ).toString();

        assert.equal(depositAmount, aboveMinimum);
      });
    });
  });
});
