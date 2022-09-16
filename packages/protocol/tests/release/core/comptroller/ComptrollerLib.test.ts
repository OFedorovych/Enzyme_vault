import { randomAddress } from '@enzymefinance/ethers';
import { ComptrollerLib, FundDeployer } from '@enzymefinance/protocol';
import type { ProtocolDeployment } from '@enzymefinance/testutils';
import { deployProtocolFixture } from '@enzymefinance/testutils';

let fork: ProtocolDeployment;

beforeEach(async () => {
  fork = await deployProtocolFixture();
});

describe('constructor', () => {
  it('sets initial state for library', async () => {
    const comptrollerLib = fork.deployment.comptrollerLib;

    expect(await comptrollerLib.getDispatcher()).toMatchAddress(fork.deployment.dispatcher);
    expect(await comptrollerLib.getExternalPositionManager()).toMatchAddress(fork.deployment.externalPositionManager);
    expect(await comptrollerLib.getFeeManager()).toMatchAddress(fork.deployment.feeManager);
    expect(await comptrollerLib.getFundDeployer()).toMatchAddress(fork.deployment.fundDeployer);
    expect(await comptrollerLib.getIntegrationManager()).toMatchAddress(fork.deployment.integrationManager);
    expect(await comptrollerLib.getMlnToken()).toMatchAddress(fork.config.primitives.mln);
    expect(await comptrollerLib.getPolicyManager()).toMatchAddress(fork.deployment.policyManager);
    expect(await comptrollerLib.getProtocolFeeReserve()).toMatchAddress(fork.deployment.protocolFeeReserveProxy);
    expect(await comptrollerLib.getValueInterpreter()).toMatchAddress(fork.deployment.valueInterpreter);

    // GasRelayRecipientMixin
    expect(await comptrollerLib.getGasRelayPaymasterFactory()).toMatchAddress(fork.deployment.gasRelayPaymasterFactory);
  });
});

describe('destruct calls', () => {
  it('cannot be non-delegatecalled', async () => {
    const mockFundDeployer = await FundDeployer.mock(fork.deployer);

    await mockFundDeployer.releaseIsLive.returns(true);

    const comptrollerLib = await ComptrollerLib.deploy(
      fork.deployer,
      randomAddress(),
      randomAddress(),
      mockFundDeployer,
      randomAddress(),
      randomAddress(),
      randomAddress(),
      randomAddress(),
      randomAddress(),
      randomAddress(),
      randomAddress(),
      randomAddress(),
    );

    // Calling the ComptrollerLib directly should fail for a destruct call
    await expect(mockFundDeployer.forward(comptrollerLib.destructUnactivated)).rejects.toBeRevertedWith(
      'Only delegate callable',
    );
  });
});
