// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat");
const options = require("../deploy-options-prod");
const ethers = hre.ethers;

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // We get the contract to deploy
  /* 

  
  
  

   */

  const accounts = await ethers.provider.listAccounts();

  const deployer = accounts[0];

  const user1 = accounts[1];
  const user2 = accounts[2];
  const user3 = accounts[3];
  const user4 = accounts[4];
  const user5 = accounts[5];

  const newBalance = "0x8AC7230489E80000";
  const depositAmount = "2000000000000000000";

  console.log("Setting balances of addresses");
  await hre.network.provider.send("hardhat_setBalance", [user1, newBalance]);
  await hre.network.provider.send("hardhat_setBalance", [user2, newBalance]);
  await hre.network.provider.send("hardhat_setBalance", [user3, newBalance]);
  await hre.network.provider.send("hardhat_setBalance", [user4, newBalance]);
  await hre.network.provider.send("hardhat_setBalance", [user5, newBalance]);

  console.log("Setting up account impersonations");
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [user1],
  });
  const user1Signer = await ethers.getSigner(user1);

  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [user2],
  });
  const user2Signer = await ethers.getSigner(user2);

  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [user3],
  });
  const user3Signer = await ethers.getSigner(user3);

  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [user4],
  });
  const user4Signer = await ethers.getSigner(user4);

  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [user5],
  });
  const user5Signer = await ethers.getSigner(user5);

  const currentPoolOwner = "0x4472a4b8f2194788dbfc717811392e0aa6b30bf5";
  await hre.network.provider.send("hardhat_setBalance", [
    currentPoolOwner,
    newBalance,
  ]);
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [currentPoolOwner],
  });
  const poolOwnerSigner = await ethers.getSigner(currentPoolOwner);

  console.log("Deploying LiquidityLocking");

  const llContract = await hre.ethers.getContractFactory("LiquidityLock");
  const ll = await llContract.deploy(options);

  await ll.deployed();

  console.log("LiqudityLock contract deployed to:", ll.address);

  console.log("Making first deposit");
  let tx = await ll.connect(user1Signer).deposit({ value: depositAmount });
  await tx.wait(1);

  console.log("Making second deposit");
  tx = await ll.connect(user2Signer).deposit({ value: depositAmount });
  await tx.wait(1);

  console.log("Making third deposit");
  tx = await ll.connect(user3Signer).deposit({ value: depositAmount });
  await tx.wait(1);

  console.log("Making forth deposit");
  tx = await ll.connect(user4Signer).deposit({ value: depositAmount });
  await tx.wait(1);

  console.log("Making fifth deposit");
  tx = await ll.connect(user5Signer).deposit({ value: depositAmount });
  await tx.wait(1);

  console.log("Transferring ownership of advisor pool");
  const pool = await hre.ethers.getContractAt(
    "Ownable",
    options.data.bznSource,
    poolOwnerSigner
  );

  tx = await pool.transferOwnership(ll.address);

  console.log("Running execute");
  tx = await ll.execute({ from: deployer });
  await tx.wait(1);

  // now query how many LP Tokens and extra BZN the contract got

  const lpTokenTotal = await ll.totalLiquidityAmount();
  const extraBzn = await ll.totalExtraBznAmount();

  console.log("LiquidityLocking contract got " + lpTokenTotal + " LP Tokens");
  console.log("LiquidityLocking contract got " + extraBzn + " extra BZN");

  console.log("Tear down");
  await hre.network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [user1],
  });

  await hre.network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [user2],
  });

  await hre.network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [user3],
  });

  await hre.network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [user4],
  });

  await hre.network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [user5],
  });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
