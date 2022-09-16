import type { ConvexCurveLpStakingAdapterArgs } from '@enzymefinance/protocol';
import type { DeployFunction } from 'hardhat-deploy/types';

import { loadConfig } from '../../../../utils/config';
import { isOneOfNetworks, Network } from '../../../../utils/helpers';

const fn: DeployFunction = async function (hre) {
  const {
    deployments: { deploy, get },
    ethers: { getSigners },
  } = hre;

  const deployer = (await getSigners())[0];
  const config = await loadConfig(hre);
  const convexCurveLpStakingWrapperFactory = await get('ConvexCurveLpStakingWrapperFactory');
  const curvePriceFeed = await get('CurvePriceFeed');
  const integrationManager = await get('IntegrationManager');

  await deploy('ConvexCurveLpStakingAdapter', {
    args: [
      integrationManager.address,
      curvePriceFeed.address,
      config.wrappedNativeAsset,
      convexCurveLpStakingWrapperFactory.address,
      config.curve.nativeAssetAddress,
    ] as ConvexCurveLpStakingAdapterArgs,
    from: deployer.address,
    linkedData: {
      nonSlippageAdapter: true,
      type: 'ADAPTER',
    },
    log: true,
    skipIfAlreadyDeployed: true,
  });
};

fn.tags = ['Release', 'Adapters', 'ConvexCurveLpStakingAdapter'];
fn.dependencies = ['Config', 'ConvexCurveLpStakingWrapperFactory', 'CurvePriceFeed', 'IntegrationManager'];

fn.skip = async (hre) => {
  const chain = await hre.getChainId();

  return !isOneOfNetworks(chain, [Network.HOMESTEAD]);
};

export default fn;
