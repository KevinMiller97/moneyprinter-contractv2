require("@nomicfoundation/hardhat-toolbox");
require('@openzeppelin/hardhat-upgrades');
require('dotenv').config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.27",
  /**
   * 
  networks: {
    hardhat: {
      chainId: 1337, // Configures the local network
    },
    running: {
      url: "http://localhost:8545",
      chainId: 1337,
    },
  },
  */
  networks: {
    fuji: {
      url: process.env.FUJI_RPC_URL,
      accounts: [process.env.PRIVATE_KEY],
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL, 
      accounts: [process.env.PRIVATE_KEY],
      chainId: 84532,
    },
  }
};
