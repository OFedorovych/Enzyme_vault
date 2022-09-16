import type { AddressLike } from '@enzymefinance/ethers';
import { randomAddress } from '@enzymefinance/ethers';
import { ITestStandardToken, ITestYearnVaultV2 } from '@enzymefinance/protocol';
import type { ProtocolDeployment } from '@enzymefinance/testutils';
import { deployProtocolFixture, getAssetUnit } from '@enzymefinance/testutils';
import { utils } from 'ethers';

let fork: ProtocolDeployment;

beforeEach(async () => {
  fork = await deployProtocolFixture();
});

describe('constructor', () => {
  it('sets state vars', async () => {
    const yearnVaultV2PriceFeed = fork.deployment.yearnVaultV2PriceFeed;

    // Assert each derivative is properly registered
    for (const yVaultAddress of Object.values(fork.config.yearn.vaultV2.yVaults) as AddressLike[]) {
      const yVault = new ITestYearnVaultV2(yVaultAddress, provider);

      expect(await yearnVaultV2PriceFeed.isSupportedAsset(yVault)).toBe(true);
      expect(await yearnVaultV2PriceFeed.getUnderlyingForDerivative(yVault)).toMatchAddress(await yVault.token());
    }

    expect(await yearnVaultV2PriceFeed.getYearnVaultV2Registry()).toMatchAddress(fork.config.yearn.vaultV2.registry);

    // SingleUnderlyingDerivativeRegistryMixin
    expect(await yearnVaultV2PriceFeed.getFundDeployer()).toMatchAddress(fork.deployment.fundDeployer);
  });
});

describe('addDerivatives', () => {
  // The "happy path" is tested in the constructor() tests

  it('reverts when using an invalid underlying token for yVault', async () => {
    const yearnVaultV2PriceFeed = fork.deployment.yearnVaultV2PriceFeed;
    const yVault = new ITestYearnVaultV2(fork.config.yearn.vaultV2.yVaults.yUsdc, provider);

    // De-register valid yVault
    await yearnVaultV2PriceFeed.removeDerivatives([yVault]);
    expect(await yearnVaultV2PriceFeed.isSupportedAsset(yVault)).toBe(false);

    await expect(yearnVaultV2PriceFeed.addDerivatives([yVault], [randomAddress()])).rejects.toBeRevertedWith(
      'Invalid yVault for underlying',
    );
  });

  it('reverts when adding an invalid yVault', async () => {
    await expect(
      fork.deployment.yearnVaultV2PriceFeed.addDerivatives([randomAddress()], [randomAddress()]),
    ).rejects.toBeRevertedWith('Invalid yVault for underlying');
  });
});

describe('calcUnderlyingValues', () => {
  it('returns the correct rate for underlying token (18-decimal underlying)', async () => {
    const yearnVaultV2PriceFeed = fork.deployment.yearnVaultV2PriceFeed;
    const yVault = new ITestYearnVaultV2(fork.config.yearn.vaultV2.yVaults.yDai, provider);
    const underlying = new ITestStandardToken(await yVault.token(), provider);

    expect(await underlying.decimals()).toEqBigNumber(18);

    const feedRate = await yearnVaultV2PriceFeed.calcUnderlyingValues.args(yVault, utils.parseEther('1')).call();

    expect(feedRate.underlyingAmounts_[0]).toEqBigNumber(await yVault.pricePerShare());
    expect(feedRate.underlyings_[0]).toMatchAddress(underlying);
  });

  it('returns the correct rate for underlying token (non 18-decimal underlying)', async () => {
    const yearnVaultV2PriceFeed = fork.deployment.yearnVaultV2PriceFeed;
    const yVault = new ITestYearnVaultV2(fork.config.yearn.vaultV2.yVaults.yUsdc, provider);
    const underlying = new ITestStandardToken(await yVault.token(), provider);

    expect(await underlying.decimals()).not.toEqBigNumber(18);

    const yVaultUnit = await getAssetUnit(underlying);

    const feedRate = await yearnVaultV2PriceFeed.calcUnderlyingValues.args(yVault, yVaultUnit).call();

    expect(feedRate.underlyingAmounts_[0]).toEqBigNumber(await yVault.pricePerShare());
    expect(feedRate.underlyings_[0]).toMatchAddress(underlying);
  });
});

describe('isSupportedAsset', () => {
  it('returns false for a random asset', async () => {
    const yearnVaultV2PriceFeed = fork.deployment.yearnVaultV2PriceFeed;

    expect(await yearnVaultV2PriceFeed.isSupportedAsset(randomAddress())).toBe(false);
  });

  it('returns true for a yVault', async () => {
    const yearnVaultV2PriceFeed = fork.deployment.yearnVaultV2PriceFeed;

    expect(await yearnVaultV2PriceFeed.isSupportedAsset(fork.config.yearn.vaultV2.yVaults.yUsdc)).toBe(true);
  });
});

describe('expected values', () => {
  it('returns the expected value from the valueInterpreter (18-decimal underlying)', async () => {
    const valueInterpreter = fork.deployment.valueInterpreter;
    const yVault = new ITestStandardToken(fork.config.yearn.vaultV2.yVaults.yDai, provider);
    const underlying = new ITestStandardToken(fork.config.primitives.dai, provider);

    expect(await underlying.decimals()).toEqBigNumber(18);

    const canonicalAssetValue = await valueInterpreter.calcCanonicalAssetValue
      .args(yVault, utils.parseEther('1'), underlying)
      .call();

    // Value should be a small percentage above 1 unit of the underlying
    expect(canonicalAssetValue).toBeBetweenBigNumber('1000000000000000000', '1100000000000000000');
  });

  it('returns the expected value from the valueInterpreter (non 18-decimal underlying)', async () => {
    const valueInterpreter = fork.deployment.valueInterpreter;
    const yVault = new ITestStandardToken(fork.config.yearn.vaultV2.yVaults.yUsdc, provider);
    const underlying = new ITestStandardToken(fork.config.primitives.usdc, provider);

    expect(await underlying.decimals()).not.toEqBigNumber(18);

    const yVaultUnit = await getAssetUnit(yVault);

    const canonicalAssetValue = await valueInterpreter.calcCanonicalAssetValue
      .args(yVault, yVaultUnit, underlying)
      .call();

    // Value should be a small percentage above 1 unit of the underlying
    expect(canonicalAssetValue).toBeBetweenBigNumber('1000000', '1050000');
  });
});

describe('derivative gas costs', () => {
  it.todo('adds to calcGav for weth-denominated fund');
});
