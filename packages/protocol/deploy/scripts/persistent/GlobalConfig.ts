import { sameAddress } from '@enzymefinance/ethers';
import type { GlobalConfigLibArgs, GlobalConfigProxyArgs } from '@enzymefinance/protocol';
import { encodeFunctionData, GlobalConfigLib as GlobalConfigLibContract } from '@enzymefinance/protocol';
import type { DeployFunction } from 'hardhat-deploy/types';

const fn: DeployFunction = async function (hre) {
  const {
    deployments: { deploy, get, log },
    ethers: { getSigners },
  } = hre;

  const deployer = (await getSigners())[0];
  const dispatcher = await get('Dispatcher');
  const fundDeployer = await get('FundDeployer');

  const globalConfigLib = await deploy('GlobalConfigLib', {
    args: [fundDeployer.address] as GlobalConfigLibArgs,
    from: deployer.address,
    log: true,
    skipIfAlreadyDeployed: true,
  });

  const constructData = encodeFunctionData(GlobalConfigLibContract.abi.getFunction('init'), [dispatcher.address]);
  const globalConfigProxy = await deploy('GlobalConfigProxy', {
    args: [constructData, globalConfigLib.address] as GlobalConfigProxyArgs,
    from: deployer.address,
    log: true,
    skipIfAlreadyDeployed: true,
  });

  if (!globalConfigProxy.newlyDeployed) {
    const globalConfigProxyInstance = new GlobalConfigLibContract(globalConfigProxy.address, deployer);

    if (!sameAddress(await globalConfigProxyInstance.getGlobalConfigLib(), globalConfigLib.address)) {
      log('Updating GlobalConfigLib on GlobalConfigProxy');
      await globalConfigProxyInstance.setGlobalConfigLib(globalConfigLib.address);
    }
  }
};

fn.tags = ['Persistent', 'GlobalConfig'];
fn.dependencies = ['Dispatcher', 'FundDeployer'];

export default fn;
