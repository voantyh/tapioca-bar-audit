import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { verify, updateDeployments, constants } from './utils';
import _ from 'lodash';
import { TContract } from 'tapioca-sdk/dist/shared';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const chainId = await hre.getChainId();
    const contracts: TContract[] = [];

    console.log('\nDeploying MXLiquidation');
    await deploy('MXLiquidation', {
        from: deployer,
        log: true,
    });
    await verify(hre, 'MXLiquidation', []);
    const mxLiquidation = await deployments.get('MXLiquidation');
    contracts.push({
        name: 'MXLiquidation',
        address: mxLiquidation.address,
        meta: {},
    });
    console.log('Done');

    console.log('\nDeploying MXLendingBorrowing');
    await deploy('MXLendingBorrowing', { from: deployer, log: true });
    await verify(hre, 'MXLendingBorrowing', []);
    const mxLendingBorrowing = await deployments.get('MXLendingBorrowing');
    contracts.push({
        name: 'MXLendingBorrowing',
        address: mxLendingBorrowing.address,
        meta: {},
    });
    console.log('Done');

    await updateDeployments(contracts, chainId);
};

export default func;
func.tags = ['MixologistModules'];
