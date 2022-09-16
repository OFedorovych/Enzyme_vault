require("dotenv").config();
require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-waffle");
require("chai");

const {
  MNEMONIC
  } = process.env;

module.exports = {
  solidity: {
    compilers: [
      { 
        version: "0.8.4", 
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
            details: {
              yul: false
            }
          }
        }
      },
      // { 
      //   version: "0.8.4", 
      //   settings: {
      //     optimizer: {
      //       enabled: true,
      //       runs: 200
      //     }
      //   }
      // },
      { 
        version: "0.7.6", 
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
            details: {
              yul: false
            }
          }
        }
      },
      { 
        version: "0.6.12", 
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
            details: {
              yul: false
            }
          }
        }
      },
      { 
        version: "0.4.22", 
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
            details: {
              yul: false
            }
          }
        }
      }
    ]
  },
  networks: {
    hardhat: {
      forking: {
        url: `https://mainnet.infura.io/v3/a94507622c1a4f65bd2cde89724dd70b`,
      },
      allowUnlimitedContractSize: false,
      timeout: 9999999999,
      blockGasLimit: 100000000,
      gas: 100000000,
      accounts: {mnemonic: MNEMONIC}
    }
  },
  mocha: {
    timeout: 100000000
  }
};