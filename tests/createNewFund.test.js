const { expect } = require("chai");
const { ethers } = require("hardhat");
const hre = require("hardhat");
const BN = hre.ethers.BigNumber;
const toBN = (num) => BN.from(num);

describe("New fund", function(){
    let alice
    let bob
    let kevin
    let oscar

    let aliceAddress
    let bobAddress
    let kevinAddress
    let oscarAddress

    let dispetcher
    let dispetcherAddress

    let fundDeployer
    let fundDeployerAddress

    let comptroller
    let comptrollerAddress
    let comptrollerProxyAddress
    let comptrollerFromProxy

    let protocolFeeTracker
    let protocolFeeTrackerAddress

    let vaultLib
    let vaultLibAddress
    let vaultProxy

    let valueInterpreter
    let valueInterpreterAddress

    let integrationManager
    let integrationManagerAddress

    let uniswapV2ExchangeAdapter 
    let uniswapV2ExchangeAdapterAddress
    const router = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"  //router to uniswapV2

    let _1inch
    const _1INCH_ADDRESS = "0x111111111117dC0aa78b770fA6A738034120C302"

    const _1INCH_WHALE = "0xF977814e90dA44bFA03b6295A0616a897441aceC"

    const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"

    let kevin1inchBalanceBeforeAllManipulations
    let kevin1inchBalanceAfterAllManipulations

    it("Deployment of fundDeployer", async function(){
        let signers = await hre.ethers.getSigners();
        alice = signers[0]
        bob = signers[1]
        kevin = signers[2]
        oscar = signers[3]

        aliceAddress = alice.address
        bobAddress = bob.address
        kevinAddress = kevin.address
        oscarAddress = oscar.address

        /*-------------------FundDeployer deployment-------------------*/
        let DispetcherContract = await hre.ethers.getContractFactory("Dispatcher")
        dispetcher = await DispetcherContract.connect(alice).deploy()
        await dispetcher.deployed()
        dispetcherAddress = dispetcher.address

        
        let relayHub  = "0xD216153c06E857cD7f72665E0aF1d7D82172F494"
        let trustedForwarder = aliceAddress    // ?
        let GasRelayPaymasterLib = await hre.ethers.getContractFactory("GasRelayPaymasterLib")
        let gasRelayPaymasterLib = await GasRelayPaymasterLib.deploy(WETH_ADDRESS, relayHub, trustedForwarder)
        await gasRelayPaymasterLib.deployed()
        let gasRelayPaymasterLibAddress = gasRelayPaymasterLib.address

        let GasRelayPaymasterFactory = await hre.ethers.getContractFactory("GasRelayPaymasterFactory")
        let gasRelayPaymasterFactory = await GasRelayPaymasterFactory.deploy(dispetcherAddress, gasRelayPaymasterLibAddress) 
        await gasRelayPaymasterFactory.deployed()
        let gasRelayPaymasterFactoryAddress = gasRelayPaymasterFactory.address

        let FundDeployer = await hre.ethers.getContractFactory("FundDeployer")
        fundDeployer = await FundDeployer.deploy(dispetcherAddress, gasRelayPaymasterFactoryAddress)
        await fundDeployer.deployed()
        fundDeployerAddress = fundDeployer.address
        /*-------------------Comptroller deployment-------------------*/
        let mlnToken = "0xec67005c4E498Ec7f55E092bd1d35cbC47C91892"

        let ProtocolFeeReserve = await hre.ethers.getContractFactory("ProtocolFeeReserveLib")
        let protocolFeeReserve = await ProtocolFeeReserve.deploy(dispetcherAddress, mlnToken) 
        await protocolFeeReserve.deployed()
        let protocolFeeReserveAddress = protocolFeeReserve.address

        let chainlinkStaleRateThreshold = 50000

        let ValueInterpreter = await hre.ethers.getContractFactory("ValueInterpreter")
        valueInterpreter = await ValueInterpreter.deploy(fundDeployerAddress, WETH_ADDRESS, chainlinkStaleRateThreshold) 
        await valueInterpreter.deployed()
        valueInterpreterAddress = valueInterpreter.address

        let ExternalPositionFactory = await hre.ethers.getContractFactory("ExternalPositionFactory")
        let externalPositionFactory = await ExternalPositionFactory.deploy(dispetcherAddress) 
        await externalPositionFactory.deployed()
        let externalPositionFactoryAddress = externalPositionFactory.address

        let PolicyManager = await hre.ethers.getContractFactory("PolicyManager")
        let policyManager = await PolicyManager.deploy(fundDeployerAddress, gasRelayPaymasterFactoryAddress) 
        await policyManager.deployed()
        let policyManagerAddress = policyManager.address

        let ExternalPositionManager = await hre.ethers.getContractFactory("ExternalPositionManager")
        let externalPositionManager = await ExternalPositionManager.deploy(fundDeployerAddress, externalPositionFactoryAddress, policyManagerAddress) 
        await externalPositionManager.deployed()
        let externalPositionManagerAddress = externalPositionManager.address

        let FeeManager = await hre.ethers.getContractFactory("FeeManager")
        let feeManager = await FeeManager.deploy(fundDeployerAddress) 
        await feeManager.deployed()
        let feeManagerAddress = feeManager.address
        
        let IntegrationManager = await hre.ethers.getContractFactory("IntegrationManager")
        integrationManager = await IntegrationManager.deploy(fundDeployerAddress, policyManagerAddress, valueInterpreterAddress) 
        await integrationManager.deployed()
        integrationManagerAddress = integrationManager.address

        
        let ComptrollerLib = await hre.ethers.getContractFactory("ComptrollerLib")
        comptroller = await ComptrollerLib.deploy(dispetcherAddress, protocolFeeReserveAddress, fundDeployerAddress, 
            valueInterpreterAddress, externalPositionManagerAddress, feeManagerAddress, integrationManagerAddress, 
            policyManagerAddress, gasRelayPaymasterFactoryAddress, mlnToken, WETH_ADDRESS
        ) 
        await comptroller.deployed()
        comptrollerAddress = comptroller.address

        /*-------------------ProtocolFeeTracker deployment-------------------*/
        let ProtocolFeeTracker = await hre.ethers.getContractFactory("ProtocolFeeTracker")
        protocolFeeTracker = await ProtocolFeeTracker.deploy(fundDeployerAddress) 
        await protocolFeeTracker.deployed()
        protocolFeeTrackerAddress = protocolFeeTracker.address

        /*-------------------VaultLib deployment-------------------*/
        let mlnBurner = "0x0000000000000000000000000000000000000000"
        let positionLimit = 5

        let VaultLib = await hre.ethers.getContractFactory("VaultLib")
        vaultLib = await VaultLib.deploy(externalPositionManagerAddress, gasRelayPaymasterFactoryAddress, 
            protocolFeeReserveAddress, protocolFeeTrackerAddress, mlnBurner, mlnToken, WETH_ADDRESS, positionLimit) 
        await vaultLib.deployed()
        vaultLibAddress = vaultLib.address

        /*-------------------Get 1inch tokens for Kevin and Oscar-------------------*/
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [_1INCH_WHALE],
        })

        let whale = await ethers.getSigner(_1INCH_WHALE)
        _1inch = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", _1INCH_ADDRESS)
        
        let balanceOfWhaleBefore = await _1inch.balanceOf(whale.address)
        const amountOf1INCHForKevin = toBN(100).mul(toBN(10).pow(toBN(18)))
        expect(balanceOfWhaleBefore).to.gte(amountOf1INCHForKevin)

        let balanceOfKevinBefore = await _1inch.balanceOf(kevinAddress)

        await _1inch.connect(whale).transfer(kevinAddress, amountOf1INCHForKevin)

        let balanceOfKevinAfter = await _1inch.balanceOf(kevinAddress)
        let balanceOfWhaleAfter = await _1inch.balanceOf(whale.address)

        kevin1inchBalanceBeforeAllManipulations = await _1inch.balanceOf(kevinAddress)
        
        expect(balanceOfWhaleAfter).to.be.eq(balanceOfWhaleBefore.sub(amountOf1INCHForKevin))
        expect(balanceOfKevinAfter).to.be.eq(balanceOfKevinBefore.add(amountOf1INCHForKevin))

        let balanceOfOscarBefore = await _1inch.balanceOf(oscarAddress)

        const amountOf1INCHForOscar = toBN(100000).mul(toBN(10).pow(toBN(18)))
        await _1inch.connect(whale).transfer(oscarAddress, amountOf1INCHForOscar)

        let balanceOfOscarAfter = await _1inch.balanceOf(oscarAddress)

        expect(balanceOfOscarAfter).to.be.eq(balanceOfOscarBefore.add(amountOf1INCHForOscar))

        /*-------------------Adapter deployment-------------------*/
        let UniswapV2ExchangeAdapter = await hre.ethers.getContractFactory("UniswapV2ExchangeAdapter")
        uniswapV2ExchangeAdapter = await UniswapV2ExchangeAdapter.deploy(integrationManagerAddress, router) 
        await uniswapV2ExchangeAdapter.deployed()
        uniswapV2ExchangeAdapterAddress = uniswapV2ExchangeAdapter.address

        /*-------------------WETH contract connection-------------------*/
        weth = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", WETH_ADDRESS)

        /*-------------------Uniswap router connection-------------------*/
        uniswap = await ethers.getContractAt("contracts/test/RouterInterface.sol:IUniswapV2Router02", router)
        // let predictionAboutAmountout = await uniswap.getAmountsOut(toBN(50).mul(toBN(10).pow(toBN(18))), [_1INCH_ADDRESS, WETH_ADDRESS])
    })

    it("Create new fund", async function(){
        fundDeployer = fundDeployer.connect(alice)

        await fundDeployer.setComptrollerLib(comptrollerAddress)
        await fundDeployer.setProtocolFeeTracker(protocolFeeTrackerAddress)
        await fundDeployer.setVaultLib(vaultLibAddress)

        await fundDeployer.setReleaseLive()

        await dispetcher.setCurrentFundDeployer(fundDeployerAddress)

        let _1inch = "0x111111111117dC0aa78b770fA6A738034120C302"
        let _1inchAggregator = "0xc929ad75B72593967DE83E7F7Cda0493458261D9"
        let rateAsset = 1
        await valueInterpreter.connect(alice).addPrimitives([_1inch], [_1inchAggregator], [rateAsset])

        // let dydxTokenAddress = "0x1482D014AaCbeABe40E81AAEcFa53C1B226A059F"
        // let dydxAggregatorAddress = "0x478909D4D798f3a1F11fFB25E4920C959B4aDe0b"
        // let rateAsset = 1
        // await valueInterpreter.connect(alice).addPrimitives([dydxTokenAddress], [dydxAggregatorAddress], [rateAsset])

        let fundOwner = bobAddress
        let fundName = "1INCH_Fund"
        let fundSymbol = "DF"
        let denominationAsset = _1inch //_1inch
        let sharesActionTimelock = 1
        let feeManagerConfigData = "0x"
        let policyManagerConfigData = "0x"

        let tx  = await fundDeployer.connect(alice).createNewFund(fundOwner, fundName, fundSymbol, denominationAsset, sharesActionTimelock, feeManagerConfigData, policyManagerConfigData)
        let txActive = await tx.wait()
        const event = txActive.events.find(event => event.event === 'NewFundCreated');
        vaultProxy = event.args[1]
        comptrollerProxyAddress = event.args[2]
    })

    it("Kevin buys shares in volt", async function(){
        comptroller = comptroller.attach(comptrollerProxyAddress).connect(kevin)

        let kevinEtherBalanceBefore = await hre.ethers.provider.getBalance(kevinAddress)
        let kevin1inchBalanceBefore = await _1inch.balanceOf(kevinAddress)
        let kevinSharesBalanceBefore = await vaultLib.attach(vaultProxy).balanceOf(kevinAddress)

        let investmentAmount = toBN(50).mul(toBN(10).pow(toBN(18)))
        let minSharesQuantity = toBN(1).mul(toBN(10).pow(toBN(18)))

        await _1inch.connect(kevin).approve(comptrollerProxyAddress, investmentAmount)
        await comptroller.buyShares(investmentAmount, minSharesQuantity)

        let kevinEtherBalanceAfter = await hre.ethers.provider.getBalance(kevinAddress)
        let kevin1inchBalanceAfter = await _1inch.balanceOf(kevinAddress)
        let kevinSharesBalanceAfter = await vaultLib.attach(vaultProxy).balanceOf(kevinAddress)

        expect(kevinEtherBalanceAfter).to.be.lt(kevinEtherBalanceBefore)
        expect(kevin1inchBalanceAfter).to.be.eq(kevin1inchBalanceBefore.sub(investmentAmount))
        expect(kevinSharesBalanceAfter).to.be.above(kevinSharesBalanceBefore)
    })
    
    // it("Add trecked assets", async function(){
    //     comptroller = comptroller.attach(comptrollerProxyAddress).connect(bob)
    //     const abi = ethers.utils.defaultAbiCoder;

    //     let extension = integrationManagerAddress
    //     let actionId = 1
    //     const trackedAsset = [WETH_ADDRESS]
    //     let callArgs = abi.encode(['address[]'], [trackedAsset])
        
    //     await comptroller.callOnExtension(extension, actionId, callArgs)
    // })

    it("Swap 1inch from voult for weth", async function(){
        comptroller = comptroller.attach(comptrollerProxyAddress).connect(bob)
        const abi = ethers.utils.defaultAbiCoder;

        let vaultEtherBalanceBefore = await weth.balanceOf(vaultProxy)
        let vault1inchBalanceBefore = await _1inch.balanceOf(vaultProxy)

        console.log("1INCH balance on vault before swap 1INCH for WETH ", vault1inchBalanceBefore);

        /*callOnExtension*/
        let extension = integrationManagerAddress
        let actionId = 0 
        /*callArgs*/
        let adapterParam = uniswapV2ExchangeAdapterAddress
        let takeOrderSelector = (uniswapV2ExchangeAdapter.interface.encodeFunctionData("takeOrder", ["0xD216153c06E857cD7f72665E0aF1d7D82172F494", "0x", "0x"]).slice(0, 10))
        /*integrationData*/
        const path = [_1INCH_ADDRESS, WETH_ADDRESS]
        const outgoingAssetAmount = toBN(50).mul(toBN(10).pow(toBN(18)))
        const minIncomingAssetAmount = toBN(1).mul(toBN(10).pow(toBN(16)))
        let integrationData = (abi.encode(
            ["address[]", "uint256", "uint256"],
            [path, outgoingAssetAmount, minIncomingAssetAmount]
        ))
        /*end integrationData*/
        let callArgs = abi.encode(
            ["address", "bytes4", "bytes"],
            [adapterParam, takeOrderSelector, integrationData]
        )
        /*end callArgs*/
        
        await comptroller.connect(bob).callOnExtension(extension, actionId, callArgs)

        let vaultEtherBalanceAfter = await weth.balanceOf(vaultProxy)
        let vault1inchBalanceAfter = await _1inch.balanceOf(vaultProxy)
        
        expect(vault1inchBalanceBefore).to.be.at.least(outgoingAssetAmount)
        expect(vault1inchBalanceAfter).to.be.eq(0)
        expect(vaultEtherBalanceAfter).to.be.above(vaultEtherBalanceBefore)
    })

    it("Oscar changes liquidity", async function(){
        uniswap = uniswap.connect(oscar)

        let path = [_1INCH_ADDRESS, WETH_ADDRESS]
        let amountIn = toBN(100000).mul(toBN(10).pow(toBN(18)))
        let amountOutMin = await uniswap.getAmountsOut(amountIn, path)
        let to = oscarAddress
        const blockNumBefore = await hre.ethers.provider.getBlockNumber();
        const blockBefore = await hre.ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;
        let deadline = timestampBefore + 500000000000

        await _1inch.connect(oscar).approve(router, amountIn)
        await uniswap.swapExactTokensForTokens(amountIn, amountOutMin[1], path, to, deadline)
        
        let oscars1inchBalanceAfter = await _1inch.balanceOf(oscarAddress)
        let oscarsWethBalanceAfter = await weth.balanceOf(oscarAddress)

        expect(oscars1inchBalanceAfter).to.be.eq(0)
        expect(oscarsWethBalanceAfter).to.be.at.least(amountOutMin[1])
    })

    it("Swap weth from voult back for 1inch", async function(){
        comptroller = comptroller.attach(comptrollerProxyAddress).connect(bob)
        const abi = ethers.utils.defaultAbiCoder;

        /*callOnExtension*/
        let extension = integrationManagerAddress
        let actionId = 0 
        /*callArgs*/
        let adapterParam = uniswapV2ExchangeAdapterAddress
        let takeOrderSelector = (uniswapV2ExchangeAdapter.interface.encodeFunctionData("takeOrder", ["0xD216153c06E857cD7f72665E0aF1d7D82172F494", "0x", "0x"]).slice(0, 10))
        /*integrationData*/
        const path = [WETH_ADDRESS, _1INCH_ADDRESS]
        const outgoingAssetAmount = await weth.balanceOf(vaultProxy)
        const minIncomingAssetAmount = toBN(50).mul(toBN(10).pow(toBN(18)))
        let integrationData = (abi.encode(
            ["address[]", "uint256", "uint256"],
            [path, outgoingAssetAmount, minIncomingAssetAmount]
        ))
        /*end integrationData*/
        let callArgs = abi.encode(
            ["address", "bytes4", "bytes"],
            [adapterParam, takeOrderSelector, integrationData]
        )
        /*end callArgs*/
        
        await comptroller.connect(bob).callOnExtension(extension, actionId, callArgs)

        let vaultEtherBalanceAfter = await weth.balanceOf(vaultProxy)
        let vault1inchBalanceAfter = await _1inch.balanceOf(vaultProxy)
        console.log("1INCH balance on vault after swap back ", vault1inchBalanceAfter);

        expect(vaultEtherBalanceAfter).to.be.eq(0)
        expect(vault1inchBalanceAfter).to.be.at.least(minIncomingAssetAmount)
    })

    it("Kevin redeems shares for 1INCH", async function(){
        comptroller = comptroller.attach(comptrollerProxyAddress).connect(kevin)
        vaultLib = vaultLib.attach(vaultProxy)

        let recipient = kevinAddress
        let sharesQuantity = await vaultLib.balanceOf(kevinAddress)
        let payoutAssets = [_1INCH_ADDRESS]
        let payoutAssetPercentages = [10000] // 100%

        await comptroller.redeemSharesForSpecificAssets(recipient, sharesQuantity, payoutAssets, payoutAssetPercentages)

        let kevinSharesBalanceAfter = await vaultLib.balanceOf(kevinAddress)
        let vault1inchBalanceAfter = await _1inch.balanceOf(vaultProxy)
        kevin1inchBalanceAfterAllManipulations = await _1inch.balanceOf(kevinAddress)
        expect(kevin1inchBalanceAfterAllManipulations).to.be.above(kevin1inchBalanceBeforeAllManipulations)
        expect(kevinSharesBalanceAfter).to.be.eq(0)
        expect(vault1inchBalanceAfter).to.be.eq(0)
    })
})


        // let dydxTokenAddress = "0x1482D014AaCbeABe40E81AAEcFa53C1B226A059F"
        // let dydxAggregatorAddress = "0x478909D4D798f3a1F11fFB25E4920C959B4aDe0b"
        // let rateAsset = 1
        // await valueInterpreter.connect(alice).addPrimitives([dydxTokenAddress], [dydxAggregatorAddress], [rateAsset])