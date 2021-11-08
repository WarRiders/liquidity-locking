require("dotenv").config();

require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-waffle");
require("hardhat-gas-reporter");
require("solidity-coverage");
require("hardhat-dependency-compiler");
require("solidity-coverage");

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

const forkBlockNumber = process.env.FORK_BLOCK_NUMBER;
const shouldFork =
  process.env.SHOULD_FORK.toLowerCase() === "true" ||
  process.env.SHOULD_FORK.toLowerCase() === "yes";

const hardhatNetwork = shouldFork
  ? {
      forking: {
        url: process.env.FORK_URL,
        blockNumber: forkBlockNumber,
      },
    }
  : {};

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.4",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.4.24",
        settings: {},
      },
    ],
  },
  networks: {
    hardhat: hardhatNetwork,
    rinkeby: {
      url: process.env.RINKEBY_URL || "",
      accounts: {
        mnemonic: process.env.MNEMONIC,
      },
    },
    ropsten: {
      url: process.env.ROPSTEN_URL || "",
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  dependencyCompiler: {
    paths: [
      "@warriders/bzn-core/contracts/BenzeneToken.sol",
      "@warriders/bzn-core/contracts/StandbyGamePool.sol",
      "@warriders/bzn-core/contracts/AdvisorPool.sol",
      "@warriders/bzn-core/contracts/TeamPool.sol",
    ],
  },
};
