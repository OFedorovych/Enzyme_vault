import type {
  AllowedExternalPositionTypesPerManagerPolicy,
  ComptrollerLib,
  ExternalPositionManager,
  IExternalPositionProxy,
  PolicyManager,
  VaultLib,
} from '@enzymefinance/protocol';
import {
  ExternalPositionType,
  ITestStandardToken,
  PolicyHook,
  policyManagerConfigArgs,
  uintListRegistryPerUserPolicyArgs,
  UintListUpdateType,
} from '@enzymefinance/protocol';
import type { ProtocolDeployment, SignerWithAddress } from '@enzymefinance/testutils';
import {
  compoundDebtPositionClaimComp,
  createCompoundDebtPosition,
  createNewFund,
  deployProtocolFixture,
  reactivateExternalPosition,
  removeExternalPosition,
} from '@enzymefinance/testutils';
import { BigNumber, constants } from 'ethers';

let fork: ProtocolDeployment;
let allowedExternalPositionTypesPerManagerPolicy: AllowedExternalPositionTypesPerManagerPolicy;
let fundOwner: SignerWithAddress,
  validRestrictedManager: SignerWithAddress,
  invalidRestrictedManager: SignerWithAddress,
  unrestrictedManager: SignerWithAddress,
  forbiddenManager: SignerWithAddress;
let policyManager: PolicyManager;
let externalPositionManager: ExternalPositionManager;
let comptrollerProxy: ComptrollerLib;
let vaultProxy: VaultLib;

const bypassFlag: BigNumber = constants.MaxUint256;

beforeEach(async () => {
  fork = await deployProtocolFixture();

  allowedExternalPositionTypesPerManagerPolicy = fork.deployment.allowedExternalPositionTypesPerManagerPolicy;

  [fundOwner, unrestrictedManager, validRestrictedManager, invalidRestrictedManager, forbiddenManager] = fork.accounts;
  policyManager = fork.deployment.policyManager;
  externalPositionManager = fork.deployment.externalPositionManager;

  const newFundRes = await createNewFund({
    denominationAsset: new ITestStandardToken(fork.config.primitives.usdc, provider),
    fundDeployer: fork.deployment.fundDeployer,
    fundOwner,
    policyManagerConfig: policyManagerConfigArgs({
      policies: [allowedExternalPositionTypesPerManagerPolicy],
      settings: [
        uintListRegistryPerUserPolicyArgs({
          users: [validRestrictedManager, invalidRestrictedManager, unrestrictedManager],
          listsData: [
            {
              // validRestrictedManager: listId = 0 AND new list with just CompoundDebtPosition (restricted to just CompoundDebtPosition)
              existingListIds: [0],
              newListsArgs: [
                {
                  initialItems: [ExternalPositionType.CompoundDebtPosition],
                  updateType: UintListUpdateType.None,
                },
              ],
            },
            {
              // invalidRestrictedManager: listId = 0 (cannot use CompoundDebtPosition)
              existingListIds: [0],
            },
            {
              existingListIds: [bypassFlag],
            },
          ],
        }),
      ],
    }),
    signer: fundOwner,
  });

  comptrollerProxy = newFundRes.comptrollerProxy;
  vaultProxy = newFundRes.vaultProxy;

  await vaultProxy
    .connect(fundOwner)
    .addAssetManagers([validRestrictedManager, invalidRestrictedManager, unrestrictedManager, forbiddenManager]);
});

describe('canDisable', () => {
  it('returns true', async () => {
    expect(await allowedExternalPositionTypesPerManagerPolicy.canDisable()).toBe(true);
  });
});

describe('implementsHooks', () => {
  it('returns only the correct hook', async () => {
    expect(await allowedExternalPositionTypesPerManagerPolicy.implementedHooks()).toMatchFunctionOutput(
      allowedExternalPositionTypesPerManagerPolicy.implementedHooks.fragment,
      [
        PolicyHook.CreateExternalPosition,
        PolicyHook.PostCallOnExternalPosition,
        PolicyHook.ReactivateExternalPosition,
        PolicyHook.RemoveExternalPosition,
      ],
    );
  });
});

describe('updateFundSettings', () => {
  it('unhappy path: only policy manager can update', async () => {
    await expect(
      allowedExternalPositionTypesPerManagerPolicy.updateFundSettings(
        comptrollerProxy,
        uintListRegistryPerUserPolicyArgs({
          users: [],
          listsData: [],
        }),
      ),
    ).rejects.toBeRevertedWith('Only the PolicyManager can make this call');
  });

  it('happy path', async () => {
    const listId = BigNumber.from(100);

    expect(
      await allowedExternalPositionTypesPerManagerPolicy.getListIdsForFundAndUser(
        comptrollerProxy,
        validRestrictedManager,
      ),
    ).not.toContain(listId);

    await policyManager.connect(fundOwner).updatePolicySettingsForFund(
      comptrollerProxy,
      allowedExternalPositionTypesPerManagerPolicy,
      uintListRegistryPerUserPolicyArgs({
        users: [validRestrictedManager],
        listsData: [
          {
            existingListIds: [listId],
          },
        ],
      }),
    );

    expect(
      await allowedExternalPositionTypesPerManagerPolicy.getListIdsForFundAndUser(
        comptrollerProxy,
        validRestrictedManager,
      ),
    ).toEqual([listId]);
  });
});

describe('validateRule', () => {
  const revertMessage = 'Rule evaluated to false: ALLOWED_EXTERNAL_POSITION_TYPES_PER_MANAGER';

  /**
   * For each of the PolicyHook's below, we are testing 5 conditions:
   * invalidRestrictedManager: Some lists are defined for a manager and EP type is in none of the lists = cannot use EP
   * forbiddenManager: not lists are defined for a manager = cannot use EP
   * validRestrictedManager: some lists are defined for a manager and EP type is in any of the lists = can use EP
   * unrestrictedManager: bypass_flag is set for a manager = can use EP
   * fundOwner: enabled by default = can use EP
   */

  describe('PolicyHook.CreateExternalPosition', () => {
    it('unhappy path: invalid restricted manager', async () => {
      await expect(
        createCompoundDebtPosition({
          comptrollerProxy,
          externalPositionManager,
          signer: invalidRestrictedManager,
        }),
      ).rejects.toBeRevertedWith(revertMessage);
    });

    it('unhappy path: forbidden manager', async () => {
      await expect(
        createCompoundDebtPosition({
          comptrollerProxy,
          externalPositionManager,
          signer: forbiddenManager,
        }),
      ).rejects.toBeRevertedWith(revertMessage);
    });

    it('happy path: valid restricted manager', async () => {
      await createCompoundDebtPosition({
        comptrollerProxy,
        externalPositionManager,
        signer: validRestrictedManager,
      });
    });

    it('happy path: unrestricted manager', async () => {
      await createCompoundDebtPosition({
        comptrollerProxy,
        externalPositionManager,
        signer: unrestrictedManager,
      });
    });

    it('happy path: fund owner', async () => {
      await createCompoundDebtPosition({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
      });
    });
  });

  describe('PolicyHook.PostCallOnExternalPosition', () => {
    let externalPositionProxy: IExternalPositionProxy;

    beforeEach(async () => {
      const createCompoundDebtPositionRes = await createCompoundDebtPosition({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
      });

      externalPositionProxy = createCompoundDebtPositionRes.externalPositionProxy;
    });

    it('unhappy path: invalid restricted manager', async () => {
      await expect(
        compoundDebtPositionClaimComp({
          comptrollerProxy,
          vaultProxy,
          externalPositionManager: fork.deployment.externalPositionManager,
          externalPositionProxy,
          fundOwner: invalidRestrictedManager,
        }),
      ).rejects.toBeRevertedWith(revertMessage);
    });

    it('unhappy path: forbidden manager', async () => {
      await expect(
        compoundDebtPositionClaimComp({
          comptrollerProxy,
          vaultProxy,
          externalPositionManager: fork.deployment.externalPositionManager,
          externalPositionProxy,
          fundOwner: forbiddenManager,
        }),
      ).rejects.toBeRevertedWith(revertMessage);
    });

    it('happy path: valid restricted manager', async () => {
      await compoundDebtPositionClaimComp({
        comptrollerProxy,
        vaultProxy,
        externalPositionManager: fork.deployment.externalPositionManager,
        externalPositionProxy,
        fundOwner: validRestrictedManager,
      });
    });

    it('happy path: unrestricted manager', async () => {
      await compoundDebtPositionClaimComp({
        comptrollerProxy,
        vaultProxy,
        externalPositionManager: fork.deployment.externalPositionManager,
        externalPositionProxy,
        fundOwner: unrestrictedManager,
      });
    });

    it('happy path: fund owner', async () => {
      await compoundDebtPositionClaimComp({
        comptrollerProxy,
        vaultProxy,
        externalPositionManager: fork.deployment.externalPositionManager,
        externalPositionProxy,
        fundOwner,
      });
    });
  });

  describe('PolicyHook.ReactivateExternalPosition', () => {
    let externalPositionProxy: IExternalPositionProxy;

    beforeEach(async () => {
      const createCompoundDebtPositionRes = await createCompoundDebtPosition({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
      });

      externalPositionProxy = createCompoundDebtPositionRes.externalPositionProxy;

      await removeExternalPosition({
        comptrollerProxy,
        externalPositionManager,
        externalPositionProxy,
        signer: fundOwner,
      });
    });

    it('unhappy path: invalid restricted manager', async () => {
      await expect(
        reactivateExternalPosition({
          comptrollerProxy,
          externalPositionManager,
          externalPositionProxy,
          signer: invalidRestrictedManager,
        }),
      ).rejects.toBeRevertedWith(revertMessage);
    });

    it('unhappy path: forbidden manager', async () => {
      await expect(
        reactivateExternalPosition({
          comptrollerProxy,
          externalPositionManager,
          externalPositionProxy,
          signer: forbiddenManager,
        }),
      ).rejects.toBeRevertedWith(revertMessage);
    });

    it('happy path: valid restricted manager', async () => {
      await reactivateExternalPosition({
        comptrollerProxy,
        externalPositionManager,
        externalPositionProxy,
        signer: validRestrictedManager,
      });
    });

    it('happy path: unrestricted manager', async () => {
      await reactivateExternalPosition({
        comptrollerProxy,
        externalPositionManager,
        externalPositionProxy,
        signer: unrestrictedManager,
      });
    });

    it('happy path: fund owner', async () => {
      await reactivateExternalPosition({
        comptrollerProxy,
        externalPositionManager,
        externalPositionProxy,
        signer: fundOwner,
      });
    });
  });

  describe('PolicyHook.RemoveExternalPosition', () => {
    let externalPositionProxy: IExternalPositionProxy;

    beforeEach(async () => {
      const createCompoundDebtPositionRes = await createCompoundDebtPosition({
        comptrollerProxy,
        externalPositionManager,
        signer: fundOwner,
      });

      externalPositionProxy = createCompoundDebtPositionRes.externalPositionProxy;
    });

    it('unhappy path: invalid restricted manager', async () => {
      await expect(
        removeExternalPosition({
          comptrollerProxy,
          externalPositionManager,
          externalPositionProxy,
          signer: invalidRestrictedManager,
        }),
      ).rejects.toBeRevertedWith(revertMessage);
    });

    it('unhappy path: forbidden manager', async () => {
      await expect(
        removeExternalPosition({
          comptrollerProxy,
          externalPositionManager,
          externalPositionProxy,
          signer: forbiddenManager,
        }),
      ).rejects.toBeRevertedWith(revertMessage);
    });

    it('happy path: valid restricted manager', async () => {
      await removeExternalPosition({
        comptrollerProxy,
        externalPositionManager,
        externalPositionProxy,
        signer: validRestrictedManager,
      });
    });

    it('happy path: unrestricted manager', async () => {
      await removeExternalPosition({
        comptrollerProxy,
        externalPositionManager,
        externalPositionProxy,
        signer: unrestrictedManager,
      });
    });

    it('happy path: fund owner', async () => {
      await removeExternalPosition({
        comptrollerProxy,
        externalPositionManager,
        externalPositionProxy,
        signer: fundOwner,
      });
    });
  });
});
