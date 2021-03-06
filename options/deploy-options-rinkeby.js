module.exports = {
  data: {
    minimum: "1000000000000000000",
    maximum: "100000000000000000000",
    uniswapRouter: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    bznAddress: "0x8F54971B2e385FF8136aE7EbA5224274fB0ef9C5",
    bznSoftLimit: "450000000000000000000",
    bznHardLimit: "900000000000000000000",
    bznRatio: "100",
    bznSource: "0x877181bd082C53457e40847e243a40A61d61B954",
    recipient: "0x4EeABa74D7f51fe3202D7963EFf61D2e7e166cBa",
    staking: {
      duration: 518400,
      isLinear: true,
      totalRewardAmount: "150000000000000000000",
    },
    dueDate: 1638128832,
    startDate: 1637118899,
  },
  schedule: {
    isValid: true,
    cliffDuration: 2,
    duration: 4,
    interval: 1,
  },
};
