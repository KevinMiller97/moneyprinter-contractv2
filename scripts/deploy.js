const { ethers, upgrades } = require('hardhat');

async function main() {
  const [deployer, addr1] = await ethers.getSigners();

  console.log('Deploying contracts with the account:', deployer.address);

  // Deploy MoneyToken
  const MoneyToken = await ethers.getContractFactory('MoneyToken');
  const moneyToken = await upgrades.deployProxy(MoneyToken, [deployer.address], {
    initializer: 'initialize',
  });
  await moneyToken.waitForDeployment();
  console.log('MoneyToken deployed to:', await moneyToken.getAddress());

  // Deploy BondsNFT
  const BondsNFT = await ethers.getContractFactory('BondsNFT');
  const bondsNFT = await upgrades.deployProxy(BondsNFT, [deployer.address], {
    initializer: 'initialize',
  });
  await bondsNFT.waitForDeployment();
  console.log('BondsNFT deployed to:', await bondsNFT.getAddress());

  // Set MoneyToken address in BondsNFT
  await bondsNFT.setMoneyTokenAddress(await moneyToken.getAddress());
  await moneyToken.setBondNFTAddress(await bondsNFT.getAddress())

  console.log('Deployment and initial setup complete.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error in deployment script:', error);
    process.exit(1);
  });
