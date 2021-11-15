module.exports = {
  data: {
    minimum: "1000000000000000000",
    maximum: "100000000000000000000",
    uniswapRouter: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    bznAddress: "0x6524b87960c2d573ae514fd4181777e7842435d4",
    bznSoftLimit: "1500000000000000000000",
    bznHardLimit: "1000000000000000000000000",
    bznRatio: "1000",
    bznSource: "0xc866a25f68be46365c7F5633827Ef7600B8d1113",
    recipient: "0x4EeABa74D7f51fe3202D7963EFf61D2e7e166cBa",
    staking: {
      duration: 63070000,
      isLinear: true,
      totalRewardAmount: "100000000000000000000",
    },
    dueDate: 1634945648,
    startDate: 1634945648 - 604800,
  },
  schedule: {
    isValid: true,
    cliffDuration: 30,
    duration: 335,
    interval: 1,
  },
};
