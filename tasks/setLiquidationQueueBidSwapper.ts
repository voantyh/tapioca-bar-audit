import { HardhatRuntimeEnvironment } from 'hardhat/types';
import _ from 'lodash';
import { getDeployment, getSingularityContract } from './utils';

//Execution example:
//      npx hardhat setLiquidationQueueBidSwapper --singularity "<address>" --swapper "<cap>"
export const setLiquidationQueueBidSwapper = async (
    taskArgs: any,
    hre: HardhatRuntimeEnvironment,
) => {
    const beachBarContract = await getDeployment(hre, 'BeachBar');
    const { singularityContract, singularityAddress } =
        await getSingularityContract(taskArgs, hre);

    const callData = singularityContract.interface.encodeFunctionData(
        'updateLQUsdoSwapper',
        [taskArgs['swapper']],
    );

    await beachBarContract.executeMixologistFn([singularityAddress], [callData],true);
};

export const setLiquidationQueueBidSwapper__task = async (
    args: any,
    hre: HardhatRuntimeEnvironment,
) => {
    console.log(
        `Setting LiquidationQueue big swapper on singularity: ${args['singularity']}`,
    );
    await setLiquidationQueueBidSwapper(args, hre);
    console.log('Execution completed');
};
