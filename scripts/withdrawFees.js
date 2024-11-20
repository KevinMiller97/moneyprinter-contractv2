const { ethers } = require('hardhat');

async function main() {
  // Replace with your deployed contract address
  const bondContractAddress = "0x9d4454B023096f34B160D6B654540c56A1F81688";

  // Fetch the contract and the signers
  const [owner] = await ethers.getSigners();
  const bondContract = await ethers.getContractAt("BondsNFT", bondContractAddress);

  // Verify the owner address is correct
  console.log("Withdrawing fees with the owner account:", owner.address);

  /*
  // Fetch the current fee balance
  const feeBalance = await bondContract.ethBondFeesCollected();
  console.log(`Current collected ETH fees: ${ethers.utils.formatEther(feeBalance)} ETH`);

  if (feeBalance.isZero()) {
    console.log("No fees to withdraw");
    return;
  }
    */

  // Call the withdrawETHFees function
  const tx = await bondContract.connect(owner).withdrawETHFees();
  console.log("Withdrawing fees...");
  console.log(await tx.wait());

  console.log("Fees withdrawn successfully.");
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error withdrawing fees:", error);
    process.exit(1);
  });
