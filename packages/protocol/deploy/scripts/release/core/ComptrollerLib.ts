import type { ComptrollerLibArgs } from '@enzymefinance/protocol';
import { ComptrollerLib, FundDeployer as FundDeployerContract } from '@enzymefinance/protocol';
import { constants } from 'ethers';
import type { DeployFunction } from 'hardhat-deploy/types';

import { loadConfig } from '../../../utils/config';

const fn: DeployFunction = async function (hre) {
  const {
    deployments: { deploy, get, getOrNull, log },
    ethers: { getSigners },
  } = hre;

  const config = await loadConfig(hre);
  const deployer = (await getSigners())[0];

  const dispatcher = await get('Dispatcher');
  const externalPositionManager = await get('ExternalPositionManager');
  const feeManager = await get('FeeManager');
  const fundDeployer = await get('FundDeployer');
  const gasRelayPaymasterFactory = await getOrNull('GasRelayPaymasterFactory');
  const integrationManager = await get('IntegrationManager');
  const policyManager = await get('PolicyManager');
  const protocolFeeReserveProxy = await get('ProtocolFeeReserveProxy');
  const valueInterpreter = await get('ValueInterpreter');

  const comptrollerLib = await deploy('ComptrollerLib', {
    args: [
      dispatcher.address,
      protocolFeeReserveProxy.address,
      fundDeployer.address,
      valueInterpreter.address,
      externalPositionManager.address,
      feeManager.address,
      integrationManager.address,
      policyManager.address,
      gasRelayPaymasterFactory?.address ?? constants.AddressZero,
      config.feeToken,
      config.wrappedNativeAsset,
    ] as ComptrollerLibArgs,
    from: deployer.address,
    log: true,
    skipIfAlreadyDeployed: true,
  });

  if (comptrollerLib.newlyDeployed) {
    const comptrollerLibInstance = new ComptrollerLib(comptrollerLib.address, deployer);

    // Initialize the lib with dummy data to prevent another init() call
    await comptrollerLibInstance.init(config.weth, 0);

    const fundDeployerInstance = new FundDeployerContract(fundDeployer.address, deployer);

    log('Updating ComptrollerLib on FundDeployer');
    await fundDeployerInstance.setComptrollerLib(comptrollerLib.address);
  }
};

fn.tags = ['Release', 'ComptrollerLib'];
fn.dependencies = [
  'Config',
  'Dispatcher',
  'ExternalPositionManager',
  'FeeManager',
  'FundDeployer',
  'GasRelayPaymasterFactory',
  'IntegrationManager',
  'PolicyManager',
  'ProtocolFeeReserve',
  'ValueInterpreter',
];

export default fn;
