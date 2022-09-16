import { extractEvent } from '@enzymefinance/ethers';
import {
  ITestWETH,
  MockGenericAdapter,
  MockGenericIntegratee,
  PolicyHook,
  policyManagerConfigArgs,
  validateRuleAddTrackedAssetsArgs,
} from '@enzymefinance/protocol';
import {
  addTrackedAssetsToVault,
  assertEvent,
  createFundDeployer,
  createMigrationRequest,
  createNewFund,
  deployProtocolFixture,
  generateMockPolicies,
  mockGenericSwap,
} from '@enzymefinance/testutils';
import { constants, utils } from 'ethers';

async function snapshot() {
  const {
    accounts: [fundOwner, ...remainingAccounts],
    deployment,
    config,
    deployer,
  } = await deployProtocolFixture();

  const policies = await generateMockPolicies({
    deployer,
  });

  const mockGenericIntegratee = await MockGenericIntegratee.deploy(deployer);
  const mockGenericAdapter = await MockGenericAdapter.deploy(deployer, mockGenericIntegratee);

  const orderedPolicies = Object.values(policies);
  const policiesSettingsData = [
    ...new Array(orderedPolicies.length - 1).fill(constants.HashZero),
    utils.randomBytes(10),
  ];

  const policyManagerConfig = policyManagerConfigArgs({
    policies: orderedPolicies,
    settings: policiesSettingsData,
  });

  const denominationAsset = new ITestWETH(config.weth, provider);

  return {
    accounts: remainingAccounts,
    config,
    denominationAsset,
    deployer,
    deployment,
    fundOwner,
    mockGenericAdapter,
    mockGenericIntegratee,
    orderedPolicies,
    policies,
    policiesSettingsData,
    policyManagerConfig,
  };
}

describe('constructor', () => {
  it('sets state vars', async () => {
    const fork = await deployProtocolFixture();
    const {
      deployment: { fundDeployer, policyManager },
    } = await provider.snapshot(snapshot);

    expect(await policyManager.getOwner()).toMatchAddress(await fundDeployer.getOwner());

    // GasRelayRecipientMixin
    expect(await policyManager.getGasRelayPaymasterFactory()).toMatchAddress(fork.deployment.gasRelayPaymasterFactory);
  });
});

describe('activateForFund', () => {
  it('happy path', async () => {
    // create fund with policies
    const {
      deployer,
      deployment: {
        fundDeployer,
        externalPositionManager,
        dispatcher,
        feeManager,
        gasRelayPaymasterFactory,
        integrationManager,
        policyManager,
        valueInterpreter,
        vaultLib,
      },
      fundOwner,
      denominationAsset,
      orderedPolicies,
      policyManagerConfig,
    } = await provider.snapshot(snapshot);

    const { vaultProxy } = await createNewFund({
      denominationAsset,
      fundDeployer,
      fundOwner,
      policyManagerConfig,
      signer: fundOwner,
    });

    // migrate fund
    const nextFundDeployer = await createFundDeployer({
      deployer,
      dispatcher,
      externalPositionManager,
      feeManager,
      gasRelayPaymasterFactory,
      integrationManager,
      policyManager,
      valueInterpreter,
      vaultLib,
    });

    await createMigrationRequest({
      denominationAsset,
      fundDeployer: nextFundDeployer,
      policyManagerConfigData: policyManagerConfig,
      signer: fundOwner,
      vaultProxy,
    });

    const signedNextFundDeployer = nextFundDeployer.connect(fundOwner);

    // Warp to migratable time
    const migrationTimelock = await dispatcher.getMigrationTimelock();

    await provider.send('evm_increaseTime', [migrationTimelock.toNumber()]);

    // Migration execution settles the accrued fee
    await signedNextFundDeployer.executeMigration(vaultProxy, false);

    // check activateForFund called on each policy
    for (const key in orderedPolicies) {
      expect(orderedPolicies[key].activateForFund).toHaveBeenCalledOnContract();
    }
  });
});

describe('disablePolicyForFund', () => {
  it('does not allow a caller other than the fund owner', async () => {
    const {
      accounts: [randomAccount],
      deployment: { fundDeployer, policyManager },
      policies: { mockPostBuySharesPolicy },
      fundOwner,
      denominationAsset,
      policyManagerConfig,
    } = await provider.snapshot(snapshot);

    // Create fund without policy config
    const { comptrollerProxy } = await createNewFund({
      denominationAsset,
      fundDeployer,
      fundOwner,
      policyManagerConfig,
      signer: fundOwner,
    });

    // Disable the policy
    const disablePolicyForFundCall = policyManager
      .connect(randomAccount)
      .disablePolicyForFund(comptrollerProxy, mockPostBuySharesPolicy);

    await expect(disablePolicyForFundCall).rejects.toBeRevertedWith('Only the fund owner can call this function');
  });

  it('removes specified policy and emits event if the policy allows disabling', async () => {
    const {
      deployment: { fundDeployer, policyManager },
      policies: { mockPostBuySharesPolicy },
      fundOwner,
      denominationAsset,
      policyManagerConfig,
    } = await provider.snapshot(snapshot);

    // Confirm the policy implements some hooks
    const implementedHooks = await mockPostBuySharesPolicy.implementedHooks();

    expect(implementedHooks.length).toBeGtBigNumber(0);

    // Create fund without policy config
    const { comptrollerProxy } = await createNewFund({
      denominationAsset,
      fundDeployer,
      fundOwner,
      policyManagerConfig,
      signer: fundOwner,
    });

    // Attempting to disable a policy that cannot be disabled should fail
    await expect(
      policyManager.connect(fundOwner).disablePolicyForFund(comptrollerProxy, mockPostBuySharesPolicy),
    ).rejects.toBeRevertedWith('_policy cannot be disabled');

    // Change the policy settings to allow disabling
    await mockPostBuySharesPolicy.canDisable.returns(true);

    // Disabling the policy should now succeed
    const receipt = await policyManager
      .connect(fundOwner)
      .disablePolicyForFund(comptrollerProxy, mockPostBuySharesPolicy);

    // Assert that the policy is disabled for the fund
    for (const hook of implementedHooks) {
      expect(await policyManager.policyIsEnabledOnHookForFund(comptrollerProxy, hook, mockPostBuySharesPolicy)).toBe(
        false,
      );
    }

    expect(await policyManager.getEnabledPoliciesForFund(comptrollerProxy)).not.toEqual(
      expect.arrayContaining([mockPostBuySharesPolicy.address]),
    );

    // Assert that the proper event has been emitted
    const policyDisabledEvents = extractEvent(receipt, policyManager.abi.getEvent('PolicyDisabledOnHookForFund'));

    expect(policyDisabledEvents.length).toBe(implementedHooks.length);

    for (const i in implementedHooks) {
      expect(policyDisabledEvents[0]).toMatchEventArgs({
        comptrollerProxy,
        hook: implementedHooks[i],
        policy: mockPostBuySharesPolicy,
      });
    }
  });
});

describe('enablePolicyForFund', () => {
  it('does not allow a caller other than the fund owner', async () => {
    const {
      accounts: [randomAccount],
      deployment: { fundDeployer, policyManager },
      policies: { mockPostBuySharesPolicy },
      fundOwner,
      denominationAsset,
    } = await provider.snapshot(snapshot);

    // Create fund without policy config
    const { comptrollerProxy } = await createNewFund({
      denominationAsset,
      fundDeployer,
      fundOwner,
      signer: fundOwner,
    });

    // Add the policy with addFundSettings
    const enablePolicyForFundCall = policyManager
      .connect(randomAccount)
      .enablePolicyForFund(comptrollerProxy, mockPostBuySharesPolicy, '0x');

    await expect(enablePolicyForFundCall).rejects.toBeRevertedWith('Only the fund owner can call this function');
  });

  it('does not allow a policy with a hook that potentially restricts the actions of current investors', async () => {
    const {
      deployment: { fundDeployer, policyManager },
      policies: { mockPreTransferSharesPolicy, mockRedeemSharesForSpecificAssetsPolicy },
      fundOwner,
      denominationAsset,
    } = await provider.snapshot(snapshot);

    // Create fund without policy config
    const { comptrollerProxy } = await createNewFund({
      denominationAsset,
      fundDeployer,
      fundOwner,
      signer: fundOwner,
    });

    const revertReason = '_policy restricts actions of current investors';

    // Attempting to enable a policy that implements PolicyHook.PreTransferShares should fail
    await expect(
      policyManager.connect(fundOwner).enablePolicyForFund(comptrollerProxy, mockPreTransferSharesPolicy, '0x'),
    ).rejects.toBeRevertedWith(revertReason);

    // Attempting to enable a policy that implements PolicyHook.RedeemSharesForSpecificAssetsPolicy should fail
    await expect(
      policyManager
        .connect(fundOwner)
        .enablePolicyForFund(comptrollerProxy, mockRedeemSharesForSpecificAssetsPolicy, '0x'),
    ).rejects.toBeRevertedWith(revertReason);
  });

  it('does not allow an already enabled policy', async () => {
    const {
      deployment: { fundDeployer, policyManager },
      policies: { mockPostBuySharesPolicy },
      fundOwner,
      denominationAsset,
      policyManagerConfig,
    } = await provider.snapshot(snapshot);

    // Create fund and enable mockPostBuySharesPolicy
    const { comptrollerProxy } = await createNewFund({
      denominationAsset,
      fundDeployer,
      fundOwner,
      policyManagerConfig,
      signer: fundOwner,
    });

    // Attempt to enable an already enabled policy
    const enablePolicyForFundCall = policyManager
      .connect(fundOwner)
      .enablePolicyForFund(comptrollerProxy, mockPostBuySharesPolicy, utils.randomBytes(10));

    await expect(enablePolicyForFundCall).rejects.toBeRevertedWith('Policy is already enabled');
  });

  it('adds specified policy, calls `addFundSettings` and `activateForFund` with the correct params, and emits event', async () => {
    const {
      deployment: { fundDeployer, policyManager },
      policies: { mockPostBuySharesPolicy },
      fundOwner,
      denominationAsset,
    } = await provider.snapshot(snapshot);

    // Create fund without policy config
    const { comptrollerProxy } = await createNewFund({
      denominationAsset,
      fundDeployer,
      fundOwner,
      signer: fundOwner,
    });

    // Assert that the policy disabled on the fund
    for (const hook of await mockPostBuySharesPolicy.implementedHooks()) {
      expect(await policyManager.policyIsEnabledOnHookForFund(comptrollerProxy, hook, mockPostBuySharesPolicy)).toBe(
        false,
      );
    }

    expect(await policyManager.getEnabledPoliciesForFund(comptrollerProxy)).not.toEqual(
      expect.arrayContaining([mockPostBuySharesPolicy.address]),
    );

    // Enable the mockPostBuySharesPolicy
    const policySettings = utils.randomBytes(10);
    const receipt = await policyManager
      .connect(fundOwner)
      .enablePolicyForFund(comptrollerProxy, mockPostBuySharesPolicy, policySettings);

    // Assert that the policy is enabled for the fund
    for (const hook of await mockPostBuySharesPolicy.implementedHooks()) {
      expect(await policyManager.policyIsEnabledOnHookForFund(comptrollerProxy, hook, mockPostBuySharesPolicy)).toBe(
        true,
      );
    }

    expect(await policyManager.getEnabledPoliciesForFund(comptrollerProxy)).toEqual(
      expect.arrayContaining([mockPostBuySharesPolicy.address]),
    );

    // Assert that the proper event has been emitted
    const enablePolicyEvent = policyManager.abi.getEvent('PolicyEnabledForFund');

    assertEvent(receipt, enablePolicyEvent, {
      comptrollerProxy,
      policy: mockPostBuySharesPolicy,
      settingsData: utils.hexlify(policySettings),
    });
  });

  it('Policy with no settings: adds the policy and emits an event, does NOT call `addFundSettings()` on fee but DOES call `activateForFund`', async () => {
    const {
      deployment: { fundDeployer, policyManager },
      policies: { mockPostBuySharesPolicy },
      fundOwner,
      denominationAsset,
    } = await provider.snapshot(snapshot);

    // Create fund without policy config
    const { comptrollerProxy } = await createNewFund({
      denominationAsset,
      fundDeployer,
      fundOwner,
      signer: fundOwner,
    });

    // Add the policy with addFundSettings
    const receipt = await policyManager
      .connect(fundOwner)
      .enablePolicyForFund(comptrollerProxy, mockPostBuySharesPolicy, '0x');

    // Check that the policy has been added
    for (const hook of await mockPostBuySharesPolicy.implementedHooks()) {
      expect(await policyManager.policyIsEnabledOnHookForFund(comptrollerProxy, hook, mockPostBuySharesPolicy)).toBe(
        true,
      );
    }

    expect(await policyManager.getEnabledPoliciesForFund(comptrollerProxy)).toEqual(
      expect.arrayContaining([mockPostBuySharesPolicy.address]),
    );

    // Assert that the event has been emitted
    const policyEnabledForFundEvent = policyManager.abi.getEvent('PolicyEnabledForFund');

    assertEvent(receipt, policyEnabledForFundEvent);

    // Assert that addFundSettings() has NOT been called
    expect(mockPostBuySharesPolicy.addFundSettings).not.toHaveBeenCalledOnContract();
  });
});

describe('setConfigForFund', () => {
  it('does not allow a random caller', async () => {
    const {
      accounts: [randomUser],
      deployment: { policyManager },
    } = await provider.snapshot(snapshot);

    await expect(
      policyManager.connect(randomUser).setConfigForFund(constants.AddressZero, constants.AddressZero, '0x'),
    ).rejects.toBeRevertedWith('Only the FundDeployer can make this call');
  });

  it('does not allow unequal policies and settingsData array lengths', async () => {
    const {
      denominationAsset,
      accounts: [fundOwner],
      deployment: { fundDeployer },
      policies: { mockPostBuySharesPolicy },
    } = await provider.snapshot(snapshot);

    const policies = [mockPostBuySharesPolicy];
    const policiesSettings = [utils.randomBytes(10), utils.randomBytes(12), utils.randomBytes(20)];
    const policyManagerConfig = policyManagerConfigArgs({ policies, settings: policiesSettings });

    await expect(
      createNewFund({
        denominationAsset,
        fundDeployer,
        fundOwner,
        policyManagerConfig,
        signer: fundOwner,
      }),
    ).rejects.toBeRevertedWith('policies and settingsData array lengths unequal');
  });

  it('happy path', async () => {
    const {
      deployment: { fundDeployer, policyManager },
      fundOwner,
      denominationAsset,
      orderedPolicies,
      policiesSettingsData,
      policyManagerConfig,
    } = await provider.snapshot(snapshot);

    const { comptrollerProxy, receipt, vaultProxy } = await createNewFund({
      denominationAsset,
      fundDeployer,
      fundOwner,
      policyManagerConfig,
      signer: fundOwner,
    });

    // Assert state for fund
    expect(await policyManager.getVaultProxyForFund(comptrollerProxy)).toMatchAddress(vaultProxy);

    for (const policy of orderedPolicies) {
      for (const hook of await policy.implementedHooks()) {
        expect(await policyManager.policyIsEnabledOnHookForFund(comptrollerProxy, hook, policy)).toBe(true);
      }
    }

    // Assert addFundSettings was called on each policy with its settingsData,
    // only if settingsData was passed
    for (const key in orderedPolicies) {
      if (policiesSettingsData[key] === '0x') {
        expect(orderedPolicies[key].addFundSettings).not.toHaveBeenCalledOnContract();
      } else {
        expect(orderedPolicies[key].addFundSettings).toHaveBeenCalledOnContractWith(
          comptrollerProxy,
          policiesSettingsData[key],
        );
      }
    }

    // Assert PolicyEnabledForFund events
    const policyEnabledForFundEvent = policyManager.abi.getEvent('PolicyEnabledForFund');

    const events = extractEvent(receipt, policyEnabledForFundEvent);

    expect(events.length).toBe(orderedPolicies.length);

    for (let i = 0; i < orderedPolicies.length; i++) {
      expect(events[i]).toMatchEventArgs({
        comptrollerProxy: comptrollerProxy.address,
        policy: orderedPolicies[i].address,
        settingsData: utils.hexlify(policiesSettingsData[i]),
      });
    }
  });

  it('Policy with no settings: adds the policy and emits an event, does NOT call `addFundSettings()`', async () => {
    const {
      deployment: { fundDeployer, policyManager },
      policies: { mockPostBuySharesPolicy },
      fundOwner,
      denominationAsset,
    } = await provider.snapshot(snapshot);

    // Create config with empty settings for mockPostBuySharesPolicy
    const policies = [mockPostBuySharesPolicy];
    const policiesSettings = ['0x'];
    const policyManagerConfig = policyManagerConfigArgs({ policies, settings: policiesSettings });

    const { comptrollerProxy, receipt } = await createNewFund({
      denominationAsset,
      fundDeployer,
      fundOwner,
      policyManagerConfig,
      signer: fundOwner,
    });

    // Check that the policy has been added
    for (const hook of await mockPostBuySharesPolicy.implementedHooks()) {
      expect(await policyManager.policyIsEnabledOnHookForFund(comptrollerProxy, hook, mockPostBuySharesPolicy)).toBe(
        true,
      );
    }

    // Assert that the event has been emitted
    const policyEnabledForFundEvent = policyManager.abi.getEvent('PolicyEnabledForFund');

    assertEvent(receipt, policyEnabledForFundEvent);

    // Assert that addFundSettings() has NOT been called
    expect(mockPostBuySharesPolicy.addFundSettings).not.toHaveBeenCalledOnContract();
  });
});

describe('updatePolicySettingsForFund', () => {
  it('does not allow a caller other than the fund owner', async () => {
    const {
      accounts: [randomAccount],
      deployment: { fundDeployer, policyManager },
      policies: { mockPostBuySharesPolicy },
      fundOwner,
      denominationAsset,
      policyManagerConfig,
    } = await provider.snapshot(snapshot);

    const { comptrollerProxy } = await createNewFund({
      denominationAsset,
      fundDeployer,
      fundOwner,
      policyManagerConfig,
      signer: fundOwner,
    });

    // Update the mockPostBuySharesPolicy with new setting with non-fundOwner account
    const updatePolicyCall = policyManager
      .connect(randomAccount)
      .updatePolicySettingsForFund(comptrollerProxy, mockPostBuySharesPolicy, utils.randomBytes(10));

    await expect(updatePolicyCall).rejects.toBeRevertedWith('Only the fund owner can call this function');
  });

  it('calls `updateFundSettings` on the policy with the correct params', async () => {
    const {
      deployment: { fundDeployer, policyManager },
      policies: { mockPostBuySharesPolicy },
      fundOwner,
      denominationAsset,
      policyManagerConfig,
    } = await provider.snapshot(snapshot);

    const { comptrollerProxy } = await createNewFund({
      denominationAsset,
      fundDeployer,
      fundOwner,
      policyManagerConfig,
      signer: fundOwner,
    });

    const policySettings = utils.randomBytes(10);

    // Update the mockPostBuySharesPolicy with new setting
    await policyManager
      .connect(fundOwner)
      .updatePolicySettingsForFund(comptrollerProxy, mockPostBuySharesPolicy, policySettings);

    // Check that updatePolicySettingsForFund has been called with the arguments above
    expect(policyManager.updatePolicySettingsForFund).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      mockPostBuySharesPolicy,
      policySettings,
    );
  });
});

describe('validatePolicies', () => {
  // Data passed to individual hooks are validated in the tests of their invoking functions

  it('correctly handles a PolicyHook', async () => {
    const {
      policies: { mockAddTrackedAssetsPolicy, mockPostBuySharesPolicy, mockPostCoIPolicy },
      deployment: { fundDeployer, integrationManager },
      fundOwner,
      denominationAsset,
      policyManagerConfig,
      config: {
        primitives: { dai, mln },
      },
    } = await provider.snapshot(snapshot);

    const { comptrollerProxy } = await createNewFund({
      denominationAsset,
      fundDeployer,
      fundOwner,
      policyManagerConfig,
      signer: fundOwner,
    });

    const assetsToAdd = [dai, mln];

    await addTrackedAssetsToVault({
      assets: assetsToAdd,
      comptrollerProxy,
      integrationManager,
      signer: fundOwner,
    });

    const ruleArgs = validateRuleAddTrackedAssetsArgs({
      assets: assetsToAdd,
      caller: fundOwner,
    });

    expect(mockAddTrackedAssetsPolicy.validateRule).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.AddTrackedAssets,
      ruleArgs,
    );

    // Assert validateRule not called on other policies
    expect(mockPostBuySharesPolicy.validateRule).not.toHaveBeenCalledOnContract();
    expect(mockPostCoIPolicy.validateRule).not.toHaveBeenCalledOnContract();
  });

  it('reverts if return value is false', async () => {
    const {
      mockGenericAdapter,
      deployment: { fundDeployer, integrationManager },
      policies: { mockPostCoIPolicy },
      fundOwner,
      denominationAsset,
      policyManagerConfig,
    } = await provider.snapshot(snapshot);

    const { comptrollerProxy, vaultProxy } = await createNewFund({
      denominationAsset,
      fundDeployer,
      fundOwner,
      policyManagerConfig,
      signer: fundOwner,
    });

    // Set policy to return validateRule as false
    await mockPostCoIPolicy.validateRule.returns(false);

    await expect(
      mockGenericSwap({
        provider,
        comptrollerProxy,
        signer: fundOwner,
        integrationManager,
        mockGenericAdapter,
        vaultProxy,
      }),
    ).rejects.toBeRevertedWith('Rule evaluated to false');
  });
});
