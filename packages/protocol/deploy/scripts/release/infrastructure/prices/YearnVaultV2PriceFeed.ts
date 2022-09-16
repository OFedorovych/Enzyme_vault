import type { YearnVaultV2PriceFeedArgs } from '@enzymefinance/protocol';
import { ITestYearnVaultV2, YearnVaultV2PriceFeed } from '@enzymefinance/protocol';
import type { DeployFunction } from 'hardhat-deploy/types';

import { loadConfig } from '../../../../utils/config';
import { isOneOfNetworks, Network } from '../../../../utils/helpers';

const fn: DeployFunction = async function (hre) {
  const {
    deployments: { deploy, get, log },
    ethers: { getSigners },
  } = hre;

  const deployer = (await getSigners())[0];
  const config = await loadConfig(hre);
  const fundDeployer = await get('FundDeployer');

  const yearnVaultV2PriceFeed = await deploy('YearnVaultV2PriceFeed', {
    args: [fundDeployer.address, config.yearn.vaultV2.registry] as YearnVaultV2PriceFeedArgs,
    from: deployer.address,
    log: true,
    skipIfAlreadyDeployed: true,
  });

  if (yearnVaultV2PriceFeed.newlyDeployed) {
    const yearnVaultV2PriceFeedInstance = new YearnVaultV2PriceFeed(yearnVaultV2PriceFeed.address, deployer);
    const yVaults = Object.values(config.yearn.vaultV2.yVaults);
    const underlyings = await Promise.all(
      yVaults.map((yVaultAddress) => {
        const yVault = new ITestYearnVaultV2(yVaultAddress, deployer);

        return yVault.token();
      }),
    );

    if (yVaults.length) {
      log('Registering yearn vault v2 tokens');
      await yearnVaultV2PriceFeedInstance.addDerivatives(yVaults, underlyings);
    }
  }
};

fn.tags = ['Release', 'YearnVaultV2PriceFeed'];
fn.dependencies = ['Config', 'FundDeployer'];

fn.skip = async (hre) => {
  const chain = await hre.getChainId();

  return !isOneOfNetworks(chain, [Network.HOMESTEAD]);
};

export default fn;
