require("@nomicfoundation/hardhat-toolbox");
require('@openzeppelin/hardhat-upgrades');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.27",
  networks: {
    hardhat: {
      chainId: 1337, // Configures the local network
    },
    running: {
      url: "http://localhost:8545",
      chainId: 1337,
    },
  },
};
