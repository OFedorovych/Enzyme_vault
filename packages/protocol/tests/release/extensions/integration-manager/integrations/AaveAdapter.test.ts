import { randomAddress } from '@enzymefinance/ethers';
import {
  AaveAdapter,
  aaveLendArgs,
  aaveRedeemArgs,
  ITestStandardToken,
  lendSelector,
  redeemSelector,
  SpendAssetsHandleType,
} from '@enzymefinance/protocol';
import type { ProtocolDeployment } from '@enzymefinance/testutils';
import {
  aaveLend,
  aaveRedeem,
  createNewFund,
  deployProtocolFixture,
  getAssetBalances,
  getAssetUnit,
  setAccountBalance,
} from '@enzymefinance/testutils';
import { BigNumber, utils } from 'ethers';

const roundingBuffer = BigNumber.from(2);
let fork: ProtocolDeployment;

beforeEach(async () => {
  fork = await deployProtocolFixture();
});

describe('constructor', () => {
  it('sets state vars', async () => {
    const aaveAdapter = new AaveAdapter(fork.deployment.aaveAdapter, provider);
    const lendingPoolAddressProvider = await aaveAdapter.getAaveLendingPoolAddressProvider();

    expect(lendingPoolAddressProvider).toMatchAddress(fork.config.aave.lendingPoolAddressProvider);

    const referralCode = await aaveAdapter.getAaveReferralCode();

    expect(referralCode).toEqBigNumber(BigNumber.from('158'));
  });
});

describe('parseAssetsForAction', () => {
  it('does not allow a bad selector', async () => {
    const aaveAdapter = new AaveAdapter(fork.deployment.aaveAdapter, provider);
    const outgoingToken = new ITestStandardToken(fork.config.primitives.usdc, provider);
    const amount = utils.parseUnits('1', await outgoingToken.decimals());
    const aToken = new ITestStandardToken(fork.config.aave.atokens.ausdc[0], provider);

    const args = aaveLendArgs({
      aToken,
      amount,
    });

    await expect(
      aaveAdapter.parseAssetsForAction(randomAddress(), utils.randomBytes(4), args),
    ).rejects.toBeRevertedWith('_selector invalid');

    await expect(aaveAdapter.parseAssetsForAction(randomAddress(), lendSelector, args)).resolves.toBeTruthy();
  });

  it('generates expected output for lending', async () => {
    const aaveAdapter = new AaveAdapter(fork.deployment.aaveAdapter, provider);
    const outgoingToken = new ITestStandardToken(fork.config.primitives.usdc, provider);
    const amount = utils.parseUnits('1', await outgoingToken.decimals());
    const aToken = new ITestStandardToken(fork.config.aave.atokens.ausdc[0], provider);

    const args = aaveLendArgs({
      aToken,
      amount,
    });

    await expect(
      aaveAdapter.parseAssetsForAction(randomAddress(), utils.randomBytes(4), args),
    ).rejects.toBeRevertedWith('_selector invalid');

    const result = await aaveAdapter.parseAssetsForAction(randomAddress(), lendSelector, args);

    expect(result).toMatchFunctionOutput(aaveAdapter.parseAssetsForAction, {
      incomingAssets_: [aToken.address],
      minIncomingAssetAmounts_: [amount.sub(roundingBuffer)],
      spendAssetAmounts_: [amount],
      spendAssetsHandleType_: SpendAssetsHandleType.Transfer,
      spendAssets_: [outgoingToken],
    });
  });

  it('generates expected output for redeeming', async () => {
    const aaveAdapter = new AaveAdapter(fork.deployment.aaveAdapter, provider);
    const aToken = new ITestStandardToken(fork.config.aave.atokens.ausdc[0], provider);
    const amount = utils.parseUnits('1', await aToken.decimals());
    const token = new ITestStandardToken(fork.config.primitives.usdc, provider);

    const args = aaveRedeemArgs({
      aToken,
      amount,
    });

    const result = await aaveAdapter.parseAssetsForAction(randomAddress(), redeemSelector, args);

    expect(result).toMatchFunctionOutput(aaveAdapter.parseAssetsForAction, {
      incomingAssets_: [token],
      minIncomingAssetAmounts_: [amount.sub(roundingBuffer)],
      spendAssetAmounts_: [amount],
      spendAssetsHandleType_: SpendAssetsHandleType.Transfer,
      spendAssets_: [aToken],
    });
  });
});

describe('lend', () => {
  it('works as expected when called for lending by a fund', async () => {
    const [fundOwner] = fork.accounts;

    const { comptrollerProxy, vaultProxy } = await createNewFund({
      denominationAsset: new ITestStandardToken(fork.config.weth, fundOwner),
      fundDeployer: fork.deployment.fundDeployer,
      fundOwner,
      signer: fundOwner,
    });

    const token = new ITestStandardToken(fork.config.primitives.usdc, provider);
    const amount = await getAssetUnit(token);
    const aToken = new ITestStandardToken(fork.config.aave.atokens.ausdc[0], provider);

    await setAccountBalance({ account: vaultProxy, amount, provider, token });

    const [preTxIncomingAssetBalance, preTxOutgoingAssetBalance] = await getAssetBalances({
      account: vaultProxy,
      assets: [aToken, token],
    });

    const lendReceipt = await aaveLend({
      aToken,
      aaveAdapter: fork.deployment.aaveAdapter,
      amount,
      comptrollerProxy,
      fundOwner,
      integrationManager: fork.deployment.integrationManager,
    });

    const [postTxIncomingAssetBalance, postTxOutgoingAssetBalance] = await getAssetBalances({
      account: vaultProxy,
      assets: [aToken, token],
    });

    expect(postTxIncomingAssetBalance).toBeAroundBigNumber(preTxIncomingAssetBalance.add(amount), roundingBuffer);
    expect(postTxOutgoingAssetBalance).toBeAroundBigNumber(preTxOutgoingAssetBalance.sub(amount), roundingBuffer);

    expect(lendReceipt).toMatchInlineGasSnapshot(`499347`);
  });
});

describe('redeem', () => {
  it('works as expected when called for redeem by a fund', async () => {
    const [fundOwner] = fork.accounts;

    const { comptrollerProxy, vaultProxy } = await createNewFund({
      denominationAsset: new ITestStandardToken(fork.config.weth, fundOwner),
      fundDeployer: fork.deployment.fundDeployer,
      fundOwner,
      signer: fundOwner,
    });

    const aToken = new ITestStandardToken(fork.config.aave.atokens.ausdc[0], provider);
    const amount = await getAssetUnit(aToken);
    const token = new ITestStandardToken(fork.config.primitives.usdc, provider);

    await setAccountBalance({ account: vaultProxy, amount, provider, token: aToken });

    const [preTxIncomingAssetBalance, preTxOutgoingAssetBalance] = await getAssetBalances({
      account: vaultProxy,
      assets: [token, aToken],
    });

    const redeemReceipt = await aaveRedeem({
      aToken,
      aaveAdapter: fork.deployment.aaveAdapter,
      amount,
      comptrollerProxy,
      fundOwner,
      integrationManager: fork.deployment.integrationManager,
    });

    const [postTxIncomingAssetBalance, postTxOutgoingAssetBalance] = await getAssetBalances({
      account: vaultProxy,
      assets: [token, aToken],
    });

    expect(postTxIncomingAssetBalance).toBeAroundBigNumber(preTxIncomingAssetBalance.add(amount), roundingBuffer);
    expect(postTxOutgoingAssetBalance).toBeAroundBigNumber(preTxOutgoingAssetBalance.sub(amount), roundingBuffer);

    // This can vary substantially for whatever reason
    expect(redeemReceipt).toMatchInlineGasSnapshot(`580210`);
  });
});
