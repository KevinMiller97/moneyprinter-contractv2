const { ethers, upgrades } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log('Upgrading BondsNFT contract with the account:', deployer.address);

  // Fetch the address of the already-deployed proxy contract
  const proxyAddress = '0x9d4454B023096f34B160D6B654540c56A1F81688';

  // Get the updated contract factory
  const BondsNFTV2 = await ethers.getContractFactory('BondsNFT');

  // Perform the upgrade
  const upgradedBondsNFT = await upgrades.upgradeProxy(proxyAddress, BondsNFTV2);

  console.log('BondsNFT upgraded. New implementation deployed at:', await upgradedBondsNFT.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error in upgrade script:', error);
    process.exit(1);
  });