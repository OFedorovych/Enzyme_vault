import type { AddressLike, MockContract } from '@enzymefinance/ethers';
import { extractEvent, randomAddress } from '@enzymefinance/ethers';
import type { ProtocolFeeReserveLib } from '@enzymefinance/protocol';
import {
  calcProtocolFeeSharesDue,
  ComptrollerLib,
  FundDeployer,
  ITestStandardToken,
  ProtocolFeeTracker,
  VaultLib,
} from '@enzymefinance/protocol';
import type { ProtocolDeployment, SignerWithAddress } from '@enzymefinance/testutils';
import {
  assertEvent,
  assertNoEvent,
  createNewFund,
  createVaultProxy,
  deployProtocolFixture,
  getAssetUnit,
  setAccountBalance,
  transactionTimestamp,
} from '@enzymefinance/testutils';
import { BigNumber, constants, utils } from 'ethers';

let fork: ProtocolDeployment;

beforeEach(async () => {
  fork = await deployProtocolFixture();
});

describe('receive', () => {
  it('immediately wraps ETH as WETH', async () => {
    const [fundOwner] = fork.accounts;
    const weth = new ITestStandardToken(fork.config.weth, provider);

    const { vaultProxy } = await createNewFund({
      denominationAsset: weth,
      fundDeployer: fork.deployment.fundDeployer,
      fundOwner,
      signer: fundOwner,
    });

    // Send ETH to the VaultProxy
    const ethAmount = utils.parseEther('2');

    await fundOwner.sendTransaction({
      to: vaultProxy.address,
      value: ethAmount,
    });

    // VaultProxy ETH balance should be 0 and WETH balance should be the sent ETH amount
    expect(await provider.getBalance(vaultProxy.address)).toEqBigNumber(0);
    expect(await weth.balanceOf(vaultProxy)).toEqBigNumber(ethAmount);
  });
});

describe('init', () => {
  it('correctly sets initial proxy values', async () => {
    const [fundOwner] = fork.accounts;

    // Do not use a fund symbol in order to test the default value
    const { comptrollerProxy, vaultProxy } = await createNewFund({
      denominationAsset: new ITestStandardToken(fork.config.weth, provider),
      fundDeployer: fork.deployment.fundDeployer,
      fundName: 'My Fund',
      fundOwner,
      signer: fundOwner,
    });

    const accessorValue = await vaultProxy.getAccessor();

    expect(accessorValue).toMatchAddress(comptrollerProxy);

    const creatorValue = await vaultProxy.getCreator();

    expect(creatorValue).toMatchAddress(fork.deployment.dispatcher);

    const migratorValue = await vaultProxy.getMigrator();

    expect(migratorValue).toMatchAddress(constants.AddressZero);

    const ownerValue = await vaultProxy.getOwner();

    expect(ownerValue).toMatchAddress(fundOwner);

    const trackedAssetsValue = await vaultProxy.getTrackedAssets();

    expect(trackedAssetsValue).toMatchFunctionOutput(vaultProxy.getTrackedAssets, [fork.config.weth]);

    // SharesToken values

    const nameValue = await vaultProxy.name();

    expect(nameValue).toBe('My Fund');

    const symbolValue = await vaultProxy.symbol();

    expect(symbolValue).toBe('ENZF');

    const decimalsValue = await vaultProxy.decimals();

    expect(decimalsValue).toBe(18);
  });
});

describe('setFreelyTransferableShares', () => {
  let vaultProxy: VaultLib;
  let fundOwner: SignerWithAddress, fundAccessor: SignerWithAddress;

  beforeEach(async () => {
    [fundOwner, fundAccessor] = fork.accounts;

    vaultProxy = await createVaultProxy({
      fundAccessor,
      fundOwner,
      signer: fork.deployer,
      vaultLib: fork.deployment.vaultLib,
    });
  });

  it('cannot be called by the accessor', async () => {
    await expect(vaultProxy.connect(fundAccessor).setFreelyTransferableShares()).rejects.toBeRevertedWith(
      'Only the owner can call this function',
    );
  });

  it('does not allow an already-set freelyTransferableShares', async () => {
    await vaultProxy.connect(fundOwner).setFreelyTransferableShares();

    await expect(vaultProxy.connect(fundOwner).setFreelyTransferableShares()).rejects.toBeRevertedWith('Already set');
  });

  it('happy path', async () => {
    expect(await vaultProxy.sharesAreFreelyTransferable()).toBe(false);

    const receipt = await vaultProxy.connect(fundOwner).setFreelyTransferableShares();

    expect(await vaultProxy.sharesAreFreelyTransferable()).toBe(true);

    assertEvent(receipt, vaultProxy.abi.getEvent('FreelyTransferableSharesSet'));
  });
});

describe('setName', () => {
  const nextName = 'New Name';
  let vaultProxy: VaultLib;
  let fundOwner: SignerWithAddress, randomUser: SignerWithAddress;

  beforeEach(async () => {
    [fundOwner, randomUser] = fork.accounts;

    const newFundRes = await createNewFund({
      denominationAsset: new ITestStandardToken(fork.config.weth, provider),
      fundDeployer: fork.deployment.fundDeployer,
      fundName: 'Old Name',
      fundOwner,
      signer: fundOwner,
    });

    vaultProxy = newFundRes.vaultProxy;
  });

  it('cannot be called by a random user', async () => {
    await expect(vaultProxy.connect(randomUser).setName(nextName)).rejects.toBeRevertedWith(
      'Only the owner can call this function',
    );
  });

  it('happy path', async () => {
    const receipt = await vaultProxy.setName(nextName);

    expect(await vaultProxy.name()).toBe(nextName);

    assertEvent(receipt, 'NameSet', { name: nextName });
  });
});

describe('setSymbol', () => {
  const nextSymbol = 'NEW';
  let vaultProxy: VaultLib;
  let fundOwner: SignerWithAddress, randomUser: SignerWithAddress;

  beforeEach(async () => {
    [fundOwner, randomUser] = fork.accounts;

    const newFundRes = await createNewFund({
      denominationAsset: new ITestStandardToken(fork.config.weth, provider),
      fundDeployer: fork.deployment.fundDeployer,
      fundOwner,
      signer: fundOwner,
    });

    vaultProxy = newFundRes.vaultProxy;
  });

  it('cannot be called by a random user', async () => {
    await expect(vaultProxy.connect(randomUser).setSymbol(nextSymbol)).rejects.toBeRevertedWith('Unauthorized');
  });

  it('happy path', async () => {
    const receipt = await vaultProxy.setSymbol(nextSymbol);

    expect(await vaultProxy.symbol()).toBe(nextSymbol);

    assertEvent(receipt, 'SymbolSet', { symbol: nextSymbol });
  });
});

describe('setAccessorForFundReconfiguration', () => {
  let vaultProxy: VaultLib;
  let mockFundDeployer: MockContract<FundDeployer>;
  let fundOwner: SignerWithAddress, mockAccessor: MockContract<ComptrollerLib>;
  let nextAccessor: AddressLike;

  beforeEach(async () => {
    [fundOwner] = fork.accounts;

    // Create the VaultProxy instance via a mockFundDeployer set as the Dispatcher.currentFundDeployer
    // so that we can later call `setAccessorForFundReconfiguration()` directly from the mockFundDeployer.
    // mockAccessor can be any contract, necessary because the Dispatcher validates that it is a contract.
    const dispatcher = fork.deployment.dispatcher;

    mockFundDeployer = await FundDeployer.mock(fork.deployer);
    mockAccessor = await ComptrollerLib.mock(fork.deployer);

    await dispatcher.setCurrentFundDeployer(mockFundDeployer);

    const deployVaultProxyReceipt = await mockFundDeployer.forward(
      dispatcher.deployVaultProxy,
      await VaultLib.deploy(
        fork.deployer,
        fork.deployment.externalPositionManager,
        fork.deployment.gasRelayPaymasterFactory,
        fork.deployment.protocolFeeReserveProxy,
        fork.deployment.protocolFeeTracker,
        fork.config.feeToken,
        await fork.deployment.vaultLib.getMlnBurner(),
        fork.config.weth,
        fork.config.positionsLimit,
      ),
      fundOwner,
      mockAccessor,
      'Test',
    );
    const events = extractEvent(deployVaultProxyReceipt, dispatcher.abi.getEvent('VaultProxyDeployed'));

    vaultProxy = new VaultLib(events[0].args.vaultProxy, provider);
    nextAccessor = randomAddress();
  });

  it('cannot be called by the accessor or fund owner', async () => {
    const revertReason = 'Only the FundDeployer can make this call';

    await expect(
      vaultProxy.connect(fundOwner).setAccessorForFundReconfiguration(nextAccessor),
    ).rejects.toBeRevertedWith(revertReason);
    await expect(
      mockAccessor.forward(vaultProxy.setAccessorForFundReconfiguration, nextAccessor),
    ).rejects.toBeRevertedWith(revertReason);
  });

  it('correctly updates the accessor and emits the AccessorSet event', async () => {
    const prevAccessor = await vaultProxy.getAccessor();

    const receipt = await mockFundDeployer.forward(vaultProxy.setAccessorForFundReconfiguration, nextAccessor);

    expect(await vaultProxy.getAccessor()).toMatchAddress(nextAccessor);

    assertEvent(receipt, vaultProxy.abi.getEvent('AccessorSet'), {
      nextAccessor,
      prevAccessor,
    });
  });
});

describe('buyBackProtocolFeeShares', () => {
  describe('burn MLN from Vault', () => {
    let protocolFeeReserveProxy: ProtocolFeeReserveLib;
    let vaultProxy: VaultLib;
    let fundOwner: SignerWithAddress, fundAccessor: SignerWithAddress;
    let mln: ITestStandardToken;

    beforeEach(async () => {
      protocolFeeReserveProxy = fork.deployment.protocolFeeReserveProxy;
      [fundOwner, fundAccessor] = fork.accounts;
      mln = new ITestStandardToken(fork.config.primitives.mln, provider);

      const vaultLib = await VaultLib.deploy(
        fork.deployer,
        fork.deployment.externalPositionManager,
        fork.deployment.gasRelayPaymasterFactory,
        fork.deployment.protocolFeeReserveProxy,
        fork.deployment.protocolFeeTracker,
        fork.config.feeToken,
        constants.AddressZero,
        fork.config.weth,
        fork.config.positionsLimit,
      );

      vaultProxy = await createVaultProxy({
        fundAccessor,
        fundOwner,
        signer: fork.deployer,
        vaultLib,
      });

      // Mint shares to the ProtocolFeeRecipient to buy back
      await vaultProxy.connect(fundAccessor).mintShares(protocolFeeReserveProxy, utils.parseEther('1'));

      // Seed the fund with MLN so it can buy back shares
      await setAccountBalance({ account: vaultProxy, amount: await getAssetUnit(mln), provider, token: mln });
    });

    it('cannot be called by the fundOwner', async () => {
      await expect(vaultProxy.connect(fundOwner).buyBackProtocolFeeShares(1, 1, 1)).rejects.toBeRevertedWith(
        'Only the designated accessor can make this call',
      );
    });

    it('does not attempt to burn shares or MLN if mlnAmountToBurn is 0', async () => {
      const preTxSharesSupply = await vaultProxy.totalSupply();
      const preTxMlnSupply = await mln.totalSupply();

      // _mlnValue will round down to 0
      const receipt = await vaultProxy.connect(fundAccessor).buyBackProtocolFeeShares(1, 1, 1);

      expect(await vaultProxy.totalSupply()).toEqBigNumber(preTxSharesSupply);
      expect(await mln.totalSupply()).toEqBigNumber(preTxMlnSupply);

      assertNoEvent(receipt, 'ProtocolFeeSharesBoughtBack');
    });

    it('happy path', async () => {
      const preTxMlnSupply = await mln.totalSupply();
      const preTxSharesSupply = await vaultProxy.totalSupply();
      const preTxVaultMlnBalance = await mln.balanceOf(vaultProxy);
      const preTxProtocolFeeRecipientSharesBalance = await vaultProxy.balanceOf(protocolFeeReserveProxy);

      const sharesToBuyBack = preTxProtocolFeeRecipientSharesBalance.div(2);
      const buybackMlnValue = preTxVaultMlnBalance.div(4);
      const gav = 123;

      expect(sharesToBuyBack).toBeGtBigNumber(0);
      expect(buybackMlnValue).toBeGtBigNumber(0);

      const receipt = await vaultProxy
        .connect(fundAccessor)
        .buyBackProtocolFeeShares(sharesToBuyBack, buybackMlnValue, gav);

      // Assert ProtocolFeeRecipient was called correctly
      expect(protocolFeeReserveProxy.buyBackSharesViaTrustedVaultProxy).toHaveBeenCalledOnContractWith(
        sharesToBuyBack,
        buybackMlnValue,
        gav,
      );

      // TODO: move to exported constant?
      const expectedMlnBurned = buybackMlnValue.div(2);

      expect(expectedMlnBurned).toBeGtBigNumber(0);

      // Assert shares were correctly burned
      expect(await vaultProxy.totalSupply()).toEqBigNumber(preTxSharesSupply.sub(sharesToBuyBack));
      expect(await vaultProxy.balanceOf(protocolFeeReserveProxy)).toEqBigNumber(
        preTxProtocolFeeRecipientSharesBalance.sub(sharesToBuyBack),
      );

      // Assert mln was correctly burned
      expect(await mln.totalSupply()).toEqBigNumber(preTxMlnSupply.sub(expectedMlnBurned));
      expect(await mln.balanceOf(vaultProxy)).toEqBigNumber(preTxVaultMlnBalance.sub(expectedMlnBurned));

      assertEvent(receipt, 'ProtocolFeeSharesBoughtBack', {
        mlnBurned: expectedMlnBurned,
        mlnValue: buybackMlnValue,
        sharesAmount: sharesToBuyBack,
      });
    });
  });

  describe('transfer MLN to burner', () => {
    it('happy path', async () => {
      const protocolFeeReserveProxy = fork.deployment.protocolFeeReserveProxy;
      const [fundOwner, fundAccessor] = fork.accounts;
      const mln = new ITestStandardToken(fork.config.primitives.mln, provider);
      const mlnBurner = randomAddress();

      const vaultLib = await VaultLib.deploy(
        fork.deployer,
        fork.deployment.externalPositionManager,
        fork.deployment.gasRelayPaymasterFactory,
        fork.deployment.protocolFeeReserveProxy,
        fork.deployment.protocolFeeTracker,
        fork.config.feeToken,
        mlnBurner,
        fork.config.weth,
        fork.config.positionsLimit,
      );

      const vaultProxy = await createVaultProxy({
        fundAccessor,
        fundOwner,
        signer: fork.deployer,
        vaultLib,
      });

      // Mint shares to the ProtocolFeeRecipient to buy back
      await vaultProxy.connect(fundAccessor).mintShares(protocolFeeReserveProxy, utils.parseEther('1'));

      // Seed the fund with MLN so it can buy back shares
      await setAccountBalance({ account: vaultProxy, amount: await getAssetUnit(mln), provider, token: mln });

      const preTxVaultMlnBalance = await mln.balanceOf(vaultProxy);
      const preTxProtocolFeeRecipientSharesBalance = await vaultProxy.balanceOf(protocolFeeReserveProxy);

      const sharesToBuyBack = preTxProtocolFeeRecipientSharesBalance.div(2);
      const buybackMlnValue = preTxVaultMlnBalance.div(4);

      expect(sharesToBuyBack).toBeGtBigNumber(0);
      expect(buybackMlnValue).toBeGtBigNumber(0);

      await vaultProxy.connect(fundAccessor).buyBackProtocolFeeShares(sharesToBuyBack, buybackMlnValue, 123);

      // Assert that mln was transferred to the intended burner
      const expectedMlnBurned = buybackMlnValue.div(2);

      expect(await mln.balanceOf(vaultProxy)).toEqBigNumber(preTxVaultMlnBalance.sub(expectedMlnBurned));
      expect(await mln.balanceOf(mlnBurner)).toEqBigNumber(expectedMlnBurned);
    });
  });
});

describe('payProtocolFee', () => {
  let protocolFeeTracker: ProtocolFeeTracker;
  let vaultProxy: VaultLib;
  let fundOwner: SignerWithAddress, fundAccessor: SignerWithAddress;

  beforeEach(async () => {
    let fundDeployerOwner: SignerWithAddress;

    [fundOwner, fundAccessor, fundDeployerOwner] = fork.accounts;

    // Deploy a new ProtocolFeeTracker with mockFundDeployer to easily initialize the vaultProxy and turn on the fee
    const mockFundDeployer = await FundDeployer.mock(fork.deployer);

    await mockFundDeployer.getOwner.returns(fundDeployerOwner);
    protocolFeeTracker = await ProtocolFeeTracker.deploy(fork.deployer, mockFundDeployer);
    await protocolFeeTracker.connect(fundDeployerOwner).setFeeBpsDefault(30);

    const vaultLib = await VaultLib.deploy(
      fork.deployer,
      fork.deployment.externalPositionManager,
      fork.deployment.gasRelayPaymasterFactory,
      fork.deployment.protocolFeeReserveProxy,
      protocolFeeTracker,
      fork.config.feeToken,
      await fork.deployment.vaultLib.getMlnBurner(),
      fork.config.weth,
      fork.config.positionsLimit,
    );

    vaultProxy = await createVaultProxy({
      fundAccessor,
      fundOwner,
      signer: fork.deployer,
      vaultLib,
    });

    // Initialize protocol fee tracking for the vault
    await mockFundDeployer.forward(protocolFeeTracker.initializeForVault, vaultProxy);
  });

  it('cannot be called by the fundOwner', async () => {
    await expect(vaultProxy.connect(fundOwner).payProtocolFee()).rejects.toBeRevertedWith(
      'Only the designated accessor can make this call',
    );
  });

  it('does not attempt to mint shares if no shares are due', async () => {
    // No shares will be due while there are 0 shares
    const receipt = await vaultProxy.connect(fundAccessor).payProtocolFee();

    expect(await vaultProxy.totalSupply()).toEqBigNumber(0);

    assertNoEvent(receipt, 'ProtocolFeePaidInShares');
  });

  it('correctly calls the ProtocolFeeTracker, mints shares, and emits the correct event', async () => {
    // Mint shares so that a protocol fee will be due
    const initialSharesSupply = utils.parseEther('1');

    await vaultProxy.connect(fundAccessor).mintShares(vaultProxy, initialSharesSupply);

    // Warp time so that a protocol fee will be due
    await provider.send('evm_increaseTime', [3600]);

    // Get info needed to calculate the correct shares due after the tx
    const preTxLastPaidTimestamp = await protocolFeeTracker.getLastPaidForVault(vaultProxy);
    const preTxSharesSupply = await vaultProxy.totalSupply();

    const receipt = await vaultProxy.connect(fundAccessor).payProtocolFee();

    const secondsSinceLastPaid = BigNumber.from(await transactionTimestamp(receipt)).sub(preTxLastPaidTimestamp);
    const expectedProtocolFee = await calcProtocolFeeSharesDue({
      protocolFeeTracker,
      secondsSinceLastPaid,
      sharesSupply: preTxSharesSupply,
      vaultProxyAddress: vaultProxy,
    });

    expect(expectedProtocolFee).toBeGtBigNumber(0);

    expect(await vaultProxy.totalSupply()).toEqBigNumber(initialSharesSupply.add(expectedProtocolFee));

    assertEvent(receipt, 'ProtocolFeePaidInShares', {
      sharesAmount: expectedProtocolFee,
    });
  });
});

describe('callOnContract', () => {
  it.todo('write tests');
});

describe('ownership', () => {
  describe('setNominatedOwner', () => {
    it('can only be called by the contract owner', async () => {
      const [fundOwner, randomUser] = fork.accounts;

      const { vaultProxy } = await createNewFund({
        denominationAsset: new ITestStandardToken(fork.config.weth, provider),
        fundDeployer: fork.deployment.fundDeployer,
        fundOwner,
        signer: fundOwner,
      });

      await expect(vaultProxy.connect(randomUser).setNominatedOwner(randomAddress())).rejects.toBeRevertedWith(
        'Only the owner can call this function',
      );
    });

    it('does not allow an empty next owner address', async () => {
      const [fundOwner] = fork.accounts;

      const { vaultProxy } = await createNewFund({
        denominationAsset: new ITestStandardToken(fork.config.weth, provider),
        fundDeployer: fork.deployment.fundDeployer,
        fundOwner,
        signer: fundOwner,
      });

      await expect(vaultProxy.setNominatedOwner(constants.AddressZero)).rejects.toBeRevertedWith(
        '_nextNominatedOwner cannot be empty',
      );
    });

    it('does not allow the next owner to be the current owner', async () => {
      const [fundOwner] = fork.accounts;

      const { vaultProxy } = await createNewFund({
        denominationAsset: new ITestStandardToken(fork.config.weth, provider),
        fundDeployer: fork.deployment.fundDeployer,
        fundOwner,
        signer: fundOwner,
      });

      await expect(vaultProxy.setNominatedOwner(fundOwner)).rejects.toBeRevertedWith(
        '_nextNominatedOwner is already the owner',
      );
    });

    it('does not allow the next owner to already be nominated', async () => {
      const [fundOwner] = fork.accounts;

      const { vaultProxy } = await createNewFund({
        denominationAsset: new ITestStandardToken(fork.config.weth, provider),
        fundDeployer: fork.deployment.fundDeployer,
        fundOwner,
        signer: fundOwner,
      });

      // Nominate the nextOwner a first time
      const nextOwner = randomAddress();

      await vaultProxy.setNominatedOwner(nextOwner);

      // Attempt to nominate the same nextOwner a second time
      await expect(vaultProxy.setNominatedOwner(nextOwner)).rejects.toBeRevertedWith(
        '_nextNominatedOwner is already nominated',
      );
    });

    it('correctly handles nominating a new owner', async () => {
      const [fundOwner] = fork.accounts;

      const { vaultProxy } = await createNewFund({
        denominationAsset: new ITestStandardToken(fork.config.weth, provider),
        fundDeployer: fork.deployment.fundDeployer,
        fundOwner,
        signer: fundOwner,
      });

      // Nominate the nextOwner a first time
      const nextOwnerAddress = randomAddress();
      const receipt = await vaultProxy.setNominatedOwner(nextOwnerAddress);

      // NominatedOwnerSet event properly emitted
      assertEvent(receipt, 'NominatedOwnerSet', {
        nominatedOwner: nextOwnerAddress,
      });

      // New owner should have been nominated
      const getNominatedOwnerCall = await vaultProxy.getNominatedOwner();

      expect(getNominatedOwnerCall).toMatchAddress(nextOwnerAddress);

      // Ownership should not have changed
      const getOwnerCall = await vaultProxy.getOwner();

      expect(getOwnerCall).toMatchAddress(fundOwner);
    });
  });

  describe('removeNominatedOwner', () => {
    it('can only be called by the contract owner', async () => {
      const [fundOwner, randomUser] = fork.accounts;

      const { vaultProxy } = await createNewFund({
        denominationAsset: new ITestStandardToken(fork.config.weth, provider),
        fundDeployer: fork.deployment.fundDeployer,
        fundOwner,
        signer: fundOwner,
      });

      // Set nominated owner
      await vaultProxy.setNominatedOwner(randomAddress());

      // Attempt by a random user to remove nominated owner should fail
      await expect(vaultProxy.connect(randomUser).removeNominatedOwner()).rejects.toBeRevertedWith(
        'Only the owner can call this function',
      );
    });

    it('correctly handles removing the nomination', async () => {
      const [fundOwner] = fork.accounts;

      const { vaultProxy } = await createNewFund({
        denominationAsset: new ITestStandardToken(fork.config.weth, provider),
        fundDeployer: fork.deployment.fundDeployer,
        fundOwner,
        signer: fundOwner,
      });

      // Set nominated owner
      const nextOwnerAddress = randomAddress();

      await vaultProxy.setNominatedOwner(nextOwnerAddress);

      // Attempt by a random user to remove nominated owner should fail
      const receipt = await vaultProxy.removeNominatedOwner();

      // NominatedOwnerRemoved event properly emitted
      assertEvent(receipt, 'NominatedOwnerRemoved', {
        nominatedOwner: nextOwnerAddress,
      });

      // Nomination should have been removed
      const getNominatedOwnerCall = await vaultProxy.getNominatedOwner();

      expect(getNominatedOwnerCall).toMatchAddress(constants.AddressZero);

      // Ownership should not have changed
      const getOwnerCall = await vaultProxy.getOwner();

      expect(getOwnerCall).toMatchAddress(fundOwner);
    });
  });

  describe('claimOwnership', () => {
    it('can only be called by the nominatedOwner', async () => {
      const [fundOwner, randomUser] = fork.accounts;

      const { vaultProxy } = await createNewFund({
        denominationAsset: new ITestStandardToken(fork.config.weth, provider),
        fundDeployer: fork.deployment.fundDeployer,
        fundOwner,
        signer: fundOwner,
      });

      // Set nominated owner
      await vaultProxy.setNominatedOwner(randomAddress());

      // Attempt by a random user to claim ownership should fail
      await expect(vaultProxy.connect(randomUser).claimOwnership()).rejects.toBeRevertedWith(
        'Only the nominatedOwner can call this function',
      );
    });

    it('correctly handles transferring ownership', async () => {
      const [fundOwner, nominatedOwner] = fork.accounts;

      const { vaultProxy } = await createNewFund({
        denominationAsset: new ITestStandardToken(fork.config.weth, provider),
        fundDeployer: fork.deployment.fundDeployer,
        fundOwner,
        signer: fundOwner,
      });

      // Set nominated owner
      await vaultProxy.setNominatedOwner(nominatedOwner);

      // Claim ownership
      const receipt = await vaultProxy.connect(nominatedOwner).claimOwnership();

      // OwnershipTransferred event properly emitted
      assertEvent(receipt, 'OwnershipTransferred', {
        nextOwner: nominatedOwner,
        prevOwner: fundOwner,
      });

      // Owner should now be the nominatedOwner
      const getOwnerCall = await vaultProxy.getOwner();

      expect(getOwnerCall).toMatchAddress(nominatedOwner);

      // nominatedOwner should be empty
      const getNominatedOwnerCall = await vaultProxy.getNominatedOwner();

      expect(getNominatedOwnerCall).toMatchAddress(constants.AddressZero);
    });
  });
});

describe('asset managers', () => {
  let fundOwner: SignerWithAddress, fundAccessor: SignerWithAddress;
  let vaultProxy: VaultLib;

  beforeEach(async () => {
    [fundOwner, fundAccessor] = fork.accounts;

    const vaultLib = await VaultLib.deploy(
      fork.deployer,
      fork.deployment.externalPositionManager,
      fork.deployment.gasRelayPaymasterFactory,
      fork.deployment.protocolFeeReserveProxy,
      fork.deployment.protocolFeeTracker,
      fork.config.feeToken,
      await fork.deployment.vaultLib.getMlnBurner(),
      fork.config.weth,
      fork.config.positionsLimit,
    );

    vaultProxy = await createVaultProxy({
      fundAccessor,
      fundOwner,
      signer: fork.deployer,
      vaultLib,
    });
  });

  describe('addAssetManagers', () => {
    const assetManagersToAdd = [randomAddress(), randomAddress()];

    it('does not allow the accessor to call', async () => {
      await expect(vaultProxy.connect(fundAccessor).addAssetManagers(assetManagersToAdd)).rejects.toBeRevertedWith(
        'Only the owner can call this function',
      );
    });

    it('does not allow an already-registered value', async () => {
      await vaultProxy.connect(fundOwner).addAssetManagers(assetManagersToAdd);

      await expect(vaultProxy.connect(fundOwner).addAssetManagers(assetManagersToAdd)).rejects.toBeRevertedWith(
        'Manager already registered',
      );
    });

    it('happy path', async () => {
      for (const manager of assetManagersToAdd) {
        expect(await vaultProxy.canManageAssets(manager)).toBe(false);
        expect(await vaultProxy.isAssetManager(manager)).toBe(false);
      }

      const receipt = await vaultProxy.connect(fundOwner).addAssetManagers(assetManagersToAdd);

      for (const manager of assetManagersToAdd) {
        expect(await vaultProxy.canManageAssets(manager)).toBe(true);
        expect(await vaultProxy.isAssetManager(manager)).toBe(true);
      }

      const events = extractEvent(receipt, 'AssetManagerAdded');

      expect(events.length).toBe(assetManagersToAdd.length);

      for (const i in assetManagersToAdd) {
        expect(events[i].args).toMatchObject({
          manager: assetManagersToAdd[i],
        });
      }
    });
  });

  describe('removeAssetManagers', () => {
    const assetManagersToRemove = [randomAddress(), randomAddress()];

    it('does not allow the accessor to call', async () => {
      // Register the managers to be deregistered
      await vaultProxy.connect(fundOwner).addAssetManagers(assetManagersToRemove);

      await expect(
        vaultProxy.connect(fundAccessor).removeAssetManagers(assetManagersToRemove),
      ).rejects.toBeRevertedWith('Only the owner can call this function');
    });

    it('does not allow an unregistered value', async () => {
      await expect(vaultProxy.connect(fundOwner).removeAssetManagers(assetManagersToRemove)).rejects.toBeRevertedWith(
        'Manager not registered',
      );
    });

    it('happy path', async () => {
      // Register the managers to be deregistered
      await vaultProxy.connect(fundOwner).addAssetManagers(assetManagersToRemove);

      for (const manager of assetManagersToRemove) {
        expect(await vaultProxy.canManageAssets(manager)).toBe(true);
        expect(await vaultProxy.isAssetManager(manager)).toBe(true);
      }

      const receipt = await vaultProxy.connect(fundOwner).removeAssetManagers(assetManagersToRemove);

      for (const manager of assetManagersToRemove) {
        expect(await vaultProxy.canManageAssets(manager)).toBe(false);
        expect(await vaultProxy.isAssetManager(manager)).toBe(false);
      }

      const events = extractEvent(receipt, 'AssetManagerRemoved');

      expect(events.length).toBe(assetManagersToRemove.length);

      for (const i in assetManagersToRemove) {
        expect(events[i].args).toMatchObject({
          manager: assetManagersToRemove[i],
        });
      }
    });
  });
});

// Only tests access control, as behavior is tested in vaultActions.test.ts
describe('Comptroller calls to vault actions', () => {
  it('addTrackedAsset: can only be called by the accessor', async () => {
    const [fundOwner, fundAccessor] = fork.accounts;
    const vaultLib = await VaultLib.deploy(
      fork.deployer,
      fork.deployment.externalPositionManager,
      fork.deployment.gasRelayPaymasterFactory,
      fork.deployment.protocolFeeReserveProxy,
      fork.deployment.protocolFeeTracker,
      fork.config.feeToken,
      await fork.deployment.vaultLib.getMlnBurner(),
      fork.config.weth,
      fork.config.positionsLimit,
    );

    const vaultProxy = await createVaultProxy({
      fundAccessor,
      fundOwner,
      signer: fork.deployer,
      vaultLib,
    });

    await expect(vaultProxy.connect(fundOwner).addTrackedAsset(randomAddress())).rejects.toBeRevertedWith(
      'Only the designated accessor can make this call',
    );
  });

  it('burnShares: can only be called by the accessor', async () => {
    const [fundOwner, fundAccessor] = fork.accounts;
    const vaultLib = await VaultLib.deploy(
      fork.deployer,
      fork.deployment.externalPositionManager,
      fork.deployment.gasRelayPaymasterFactory,
      fork.deployment.protocolFeeReserveProxy,
      fork.deployment.protocolFeeTracker,
      fork.config.feeToken,
      await fork.deployment.vaultLib.getMlnBurner(),
      fork.config.weth,
      fork.config.positionsLimit,
    );

    const vaultProxy = await createVaultProxy({
      fundAccessor,
      fundOwner,
      signer: fork.deployer,
      vaultLib,
    });

    await expect(vaultProxy.connect(fundOwner).burnShares(randomAddress(), 1)).rejects.toBeRevertedWith(
      'Only the designated accessor can make this call',
    );
  });

  it('mintShares: can only be called by the accessor', async () => {
    const [fundOwner, fundAccessor] = fork.accounts;
    const vaultLib = await VaultLib.deploy(
      fork.deployer,
      fork.deployment.externalPositionManager,
      fork.deployment.gasRelayPaymasterFactory,
      fork.deployment.protocolFeeReserveProxy,
      fork.deployment.protocolFeeTracker,
      fork.config.feeToken,
      await fork.deployment.vaultLib.getMlnBurner(),
      fork.config.weth,
      fork.config.positionsLimit,
    );

    const vaultProxy = await createVaultProxy({
      fundAccessor,
      fundOwner,
      signer: fork.deployer,
      vaultLib,
    });

    await expect(vaultProxy.connect(fundOwner).mintShares(randomAddress(), 1)).rejects.toBeRevertedWith(
      'Only the designated accessor can make this call',
    );
  });

  it('receiveValidatedVaultAction: can only be called by the accessor', async () => {
    const [fundOwner, fundAccessor] = fork.accounts;
    const vaultLib = await VaultLib.deploy(
      fork.deployer,
      fork.deployment.externalPositionManager,
      fork.deployment.gasRelayPaymasterFactory,
      fork.deployment.protocolFeeReserveProxy,
      fork.deployment.protocolFeeTracker,
      fork.config.feeToken,
      await fork.deployment.vaultLib.getMlnBurner(),
      fork.config.weth,
      fork.config.positionsLimit,
    );

    const vaultProxy = await createVaultProxy({
      fundAccessor,
      fundOwner,
      signer: fork.deployer,
      vaultLib,
    });

    await expect(
      vaultProxy.connect(fundOwner).receiveValidatedVaultAction(0, constants.HashZero),
    ).rejects.toBeRevertedWith('Only the designated accessor can make this call');
  });

  it('transferShares: can only be called by the accessor', async () => {
    const [fundOwner, fundAccessor] = fork.accounts;
    const vaultLib = await VaultLib.deploy(
      fork.deployer,
      fork.deployment.externalPositionManager,
      fork.deployment.gasRelayPaymasterFactory,
      fork.deployment.protocolFeeReserveProxy,
      fork.deployment.protocolFeeTracker,
      fork.config.feeToken,
      await fork.deployment.vaultLib.getMlnBurner(),
      fork.config.weth,
      fork.config.positionsLimit,
    );

    const vaultProxy = await createVaultProxy({
      fundAccessor,
      fundOwner,
      signer: fork.deployer,
      vaultLib,
    });

    await expect(
      vaultProxy.connect(fundOwner).transferShares(randomAddress(), randomAddress(), 1),
    ).rejects.toBeRevertedWith('Only the designated accessor can make this call');
  });

  it('withdrawAssetTo: can only be called by the accessor', async () => {
    const [fundOwner, fundAccessor] = fork.accounts;
    const vaultLib = await VaultLib.deploy(
      fork.deployer,
      fork.deployment.externalPositionManager,
      fork.deployment.gasRelayPaymasterFactory,
      fork.deployment.protocolFeeReserveProxy,
      fork.deployment.protocolFeeTracker,
      fork.config.feeToken,
      await fork.deployment.vaultLib.getMlnBurner(),
      fork.config.weth,
      fork.config.positionsLimit,
    );

    const vaultProxy = await createVaultProxy({
      fundAccessor,
      fundOwner,
      signer: fork.deployer,
      vaultLib,
    });

    await expect(
      vaultProxy.connect(fundOwner).withdrawAssetTo(randomAddress(), randomAddress(), 1),
    ).rejects.toBeRevertedWith('Only the designated accessor can make this call');
  });
});
