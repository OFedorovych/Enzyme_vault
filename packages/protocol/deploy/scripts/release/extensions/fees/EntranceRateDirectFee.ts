import type { EntranceRateDirectFeeArgs } from '@enzymefinance/protocol';
import type { DeployFunction } from 'hardhat-deploy/types';

const fn: DeployFunction = async function (hre) {
  const {
    deployments: { deploy, get },
    ethers: { getSigners },
  } = hre;

  const deployer = (await getSigners())[0];
  const feeManager = await get('FeeManager');

  await deploy('EntranceRateDirectFee', {
    args: [feeManager.address] as EntranceRateDirectFeeArgs,
    from: deployer.address,
    linkedData: {
      type: 'FEE',
    },
    log: true,
    skipIfAlreadyDeployed: true,
  });
};

fn.tags = ['Release', 'Fees', 'EntranceRateDirectFee'];
fn.dependencies = ['FeeManager'];

export default fn;
