import {
  assetTransferArgs,
  ITestStandardToken,
  takeOrderSelector,
  uniswapV3TakeOrderArgs,
} from '@enzymefinance/protocol';
import type { ProtocolDeployment } from '@enzymefinance/testutils';
import {
  createNewFund,
  deployProtocolFixture,
  getAssetBalances,
  getAssetUnit,
  setAccountBalance,
  uniswapV3TakeOrder,
} from '@enzymefinance/testutils';
import { BigNumber } from 'ethers';

let fork: ProtocolDeployment;

beforeEach(async () => {
  fork = await deployProtocolFixture();
});

describe('constructor', () => {
  it('sets state vars', async () => {
    const uniswapV3Adapter = fork.deployment.uniswapV3Adapter;

    expect(await uniswapV3Adapter.getUniswapV3Router()).toMatchAddress(fork.config.uniswapV3.router);

    expect(await uniswapV3Adapter.getIntegrationManager()).toMatchAddress(fork.deployment.integrationManager);
  });
});

describe('takeOrder', () => {
  it('can only be called via the IntegrationManager', async () => {
    const uniswapV3Adapter = fork.deployment.uniswapV3Adapter;
    const [fundOwner] = fork.accounts;

    const { vaultProxy } = await createNewFund({
      denominationAsset: new ITestStandardToken(fork.config.primitives.usdc, provider),
      fundDeployer: fork.deployment.fundDeployer,
      fundOwner,
      signer: fundOwner,
    });

    const outgoingAsset = new ITestStandardToken(fork.config.primitives.mln, provider);
    const incomingAsset = new ITestStandardToken(fork.config.weth, provider);

    const takeOrderArgs = uniswapV3TakeOrderArgs({
      minIncomingAssetAmount: await getAssetUnit(incomingAsset),
      outgoingAssetAmount: await getAssetUnit(outgoingAsset),
      pathAddresses: [outgoingAsset, incomingAsset],
      pathFees: [BigNumber.from('3000')],
    });

    const transferArgs = await assetTransferArgs({
      adapter: uniswapV3Adapter,
      encodedCallArgs: takeOrderArgs,
      selector: takeOrderSelector,
    });

    await expect(uniswapV3Adapter.takeOrder(vaultProxy, takeOrderSelector, transferArgs)).rejects.toBeRevertedWith(
      'Only the IntegrationManager can call this function',
    );
  });

  it('does not allow pathAddresses with less than 2 assets', async () => {
    const usdc = new ITestStandardToken(fork.config.primitives.usdc, provider);
    const outgoingAsset = new ITestStandardToken(fork.config.weth, provider);
    const [fundOwner] = fork.accounts;
    const uniswapV3Adapter = fork.deployment.uniswapV3Adapter;

    const integrationManager = fork.deployment.integrationManager;

    const { comptrollerProxy, vaultProxy } = await createNewFund({
      denominationAsset: usdc,
      fundDeployer: fork.deployment.fundDeployer,
      fundOwner,
      signer: fundOwner,
    });

    const pathAddresses = [outgoingAsset];
    const outgoingAssetAmount = await getAssetUnit(outgoingAsset);
    const pathFees = [BigNumber.from('3000')];

    await setAccountBalance({ account: vaultProxy, amount: outgoingAssetAmount, provider, token: outgoingAsset });

    await expect(
      uniswapV3TakeOrder({
        provider,
        comptrollerProxy,
        fundOwner,
        integrationManager,
        minIncomingAssetAmount: 1,
        outgoingAssetAmount,
        pathAddresses,
        pathFees,
        uniswapV3Adapter: uniswapV3Adapter.address,
      }),
    ).rejects.toBeRevertedWith('pathAddresses must be >= 2');
  });

  it('does not allow a path with incorrect pathFees and pathAddress length', async () => {
    const usdc = new ITestStandardToken(fork.config.primitives.usdc, provider);
    const outgoingAsset = new ITestStandardToken(fork.config.weth, provider);
    const incomingAsset = usdc;

    const [fundOwner] = fork.accounts;
    const uniswapV3Adapter = fork.deployment.uniswapV3Adapter;

    const integrationManager = fork.deployment.integrationManager;

    const { comptrollerProxy, vaultProxy } = await createNewFund({
      denominationAsset: usdc,
      fundDeployer: fork.deployment.fundDeployer,
      fundOwner,
      signer: fundOwner,
    });

    const pathAddresses = [outgoingAsset, incomingAsset];
    const outgoingAssetAmount = await getAssetUnit(outgoingAsset);
    const pathFees = [BigNumber.from('3000'), BigNumber.from('3000')];

    await setAccountBalance({ account: vaultProxy, amount: outgoingAssetAmount, provider, token: outgoingAsset });

    await expect(
      uniswapV3TakeOrder({
        provider,
        comptrollerProxy,
        fundOwner,
        integrationManager,
        minIncomingAssetAmount: 1,
        outgoingAssetAmount,
        pathAddresses,
        pathFees,
        uniswapV3Adapter: uniswapV3Adapter.address,
      }),
    ).rejects.toBeRevertedWith('incorrect pathAddresses or pathFees length');
  });

  it('correctly swaps assets (no intermediary)', async () => {
    const usdc = new ITestStandardToken(fork.config.primitives.usdc, provider);
    const outgoingAsset = usdc;
    const incomingAsset = new ITestStandardToken(fork.config.primitives.dai, provider);
    const [fundOwner] = fork.accounts;
    const uniswapV3Adapter = fork.deployment.uniswapV3Adapter;

    const integrationManager = fork.deployment.integrationManager;

    const { comptrollerProxy, vaultProxy } = await createNewFund({
      denominationAsset: usdc,
      fundDeployer: fork.deployment.fundDeployer,
      fundOwner,
      signer: fundOwner,
    });

    const pathAddresses = [outgoingAsset, incomingAsset];
    const outgoingAssetAmount = await getAssetUnit(outgoingAsset);
    const pathFees = [BigNumber.from('3000')];

    await setAccountBalance({ account: vaultProxy, amount: outgoingAssetAmount, provider, token: outgoingAsset });

    const [preTxOutgoingAssetBalance, preTxIncomingAssetBalance] = await getAssetBalances({
      account: vaultProxy,
      assets: [outgoingAsset, incomingAsset],
    });

    await uniswapV3TakeOrder({
      provider,
      comptrollerProxy,
      fundOwner,
      integrationManager,
      minIncomingAssetAmount: 1,
      outgoingAssetAmount,
      pathAddresses,
      pathFees,
      uniswapV3Adapter: uniswapV3Adapter.address,
    });

    const [postTxOutgoingAssetBalance, postTxIncomingAssetBalance] = await getAssetBalances({
      account: vaultProxy,
      assets: [outgoingAsset, incomingAsset],
    });

    const spentAssetAmount = preTxOutgoingAssetBalance.sub(postTxOutgoingAssetBalance);
    const receivedAssetAmount = postTxIncomingAssetBalance.sub(preTxIncomingAssetBalance);

    expect(spentAssetAmount).toEqBigNumber(outgoingAssetAmount);
    expect(receivedAssetAmount).toBeAroundBigNumber(await getAssetUnit(incomingAsset), 0.03);
  });

  it('correctly swaps assets (with one intermediary)', async () => {
    const weth = new ITestStandardToken(fork.config.weth, provider);
    const dai = new ITestStandardToken(fork.config.primitives.dai, provider);
    const outgoingAsset = dai;
    const incomingAsset = new ITestStandardToken(fork.config.primitives.usdc, provider);
    const usdc = incomingAsset;
    const uniswapV3Adapter = fork.deployment.uniswapV3Adapter;

    const [fundOwner] = fork.accounts;
    const integrationManager = fork.deployment.integrationManager;

    const { comptrollerProxy, vaultProxy } = await createNewFund({
      denominationAsset: usdc,
      fundDeployer: fork.deployment.fundDeployer,
      fundOwner,
      signer: fundOwner,
    });

    const pathFees = [BigNumber.from('3000'), BigNumber.from('500')];

    const pathAddresses = [outgoingAsset, weth, incomingAsset];
    const outgoingAssetAmount = await getAssetUnit(outgoingAsset);

    await setAccountBalance({ account: vaultProxy, amount: outgoingAssetAmount, provider, token: outgoingAsset });

    const [preTxOutgoingAssetBalance, preTxIncomingAssetBalance] = await getAssetBalances({
      account: vaultProxy,
      assets: [outgoingAsset, incomingAsset],
    });

    await uniswapV3TakeOrder({
      provider,
      comptrollerProxy,
      fundOwner,
      integrationManager,
      minIncomingAssetAmount: 1,
      outgoingAssetAmount,
      pathAddresses,
      pathFees,
      uniswapV3Adapter: uniswapV3Adapter.address,
    });

    const [postTxOutgoingAssetBalance, postTxIncomingAssetBalance] = await getAssetBalances({
      account: vaultProxy,
      assets: [outgoingAsset, incomingAsset],
    });

    const spentAssetAmount = preTxOutgoingAssetBalance.sub(postTxOutgoingAssetBalance);
    const receivedAssetAmount = postTxIncomingAssetBalance.sub(preTxIncomingAssetBalance);

    expect(spentAssetAmount).toEqBigNumber(outgoingAssetAmount);
    expect(receivedAssetAmount).toBeAroundBigNumber(await getAssetUnit(incomingAsset), 0.03);
  });
});
