import hh, { ethers } from 'hardhat';
import { expect } from 'chai';
import { register } from './test.utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { mixologist } from '../typechain/contracts';

describe('LiquidationQueue test', () => {
    it('should throw if premium too high or amount too low', async () => {
        const { liquidationQueue, deployer } = await register();

        await expect(
            liquidationQueue.bid(deployer.address, 40, 1),
        ).to.be.revertedWith('LQ: premium too high');

        await expect(
            liquidationQueue.bid(deployer.address, 10, 1),
        ).to.be.revertedWith('LQ: bid too low');
    });

    it('Should make a bid', async () => {
        const { liquidationQueue, deployer, weth, LQ_META, bar, yieldBox } =
            await register();

        const POOL = 10;

        await (await weth.freeMint(LQ_META.minBidAmount)).wait();
        await (
            await weth.approve(yieldBox.address, LQ_META.minBidAmount)
        ).wait();
        await yieldBox.depositAsset(
            await liquidationQueue.lqAssetId(),
            deployer.address,
            deployer.address,
            LQ_META.minBidAmount,
            0,
        );

        await yieldBox.setApprovalForAll(liquidationQueue.address, true);
        await expect(
            liquidationQueue.bid(deployer.address, POOL, LQ_META.minBidAmount),
        ).to.emit(liquidationQueue, 'Bid');

        expect(
            (await liquidationQueue.bidPools(POOL, deployer.address)).amount,
        ).to.equal(LQ_META.minBidAmount);
    });

    it('Should make a bid, wait 10min and activate it', async () => {
        const {
            liquidationQueue,
            deployer,
            weth,
            LQ_META,
            bar,
            yieldBox,
            usdc,
            timeTravel,
        } = await register();

        const POOL = 10;

        // Bid
        await (await weth.freeMint(LQ_META.minBidAmount)).wait();
        await (
            await weth.approve(yieldBox.address, LQ_META.minBidAmount)
        ).wait();
        await yieldBox.depositAsset(
            await liquidationQueue.lqAssetId(),
            deployer.address,
            deployer.address,
            LQ_META.minBidAmount,
            0,
        );
        await yieldBox.setApprovalForAll(liquidationQueue.address, true);
        await liquidationQueue.bid(
            deployer.address,
            POOL,
            LQ_META.minBidAmount,
        );

        const liquidationQueueLqId = await liquidationQueue.lqAssetId();
        const liquidationQueueMarketId = await liquidationQueue.marketAssetId();
        const liquidationLiquidatedAssetId =
            await liquidationQueue.liquidatedAssetId();

        // Require bid activation after 10min
        await expect(
            liquidationQueue.activateBid(deployer.address, POOL),
        ).to.be.revertedWith('LQ: too soon');

        // Wait 10min
        await timeTravel(10_000);

        // Activate bid
        await expect(
            liquidationQueue.activateBid(deployer.address, POOL),
        ).to.emit(liquidationQueue, 'ActivateBid');

        // Check for deleted bid pool entry queue
        expect(
            (await liquidationQueue.bidPools(POOL, deployer.address)).amount,
        ).to.be.eq(0);

        // Check for order book entry addition record
        const lastAdditionIdx = await liquidationQueue.orderBookInfos(POOL);
        const entry = await liquidationQueue.orderBookEntries(
            POOL,
            lastAdditionIdx.nextBidPush - 1,
        );

        expect(
            entry.bidder.toLowerCase() === deployer.address.toLowerCase() &&
                entry.bidInfo.amount.eq(LQ_META.minBidAmount),
        ).to.be.true;

        // Check order pool info update
        const poolInfo = await liquidationQueue.orderBookInfos(POOL);
        expect(poolInfo.nextBidPush).to.be.eq(1);
    });

    it('Should remove an inactivated bid', async () => {
        const { liquidationQueue, deployer, weth, LQ_META, bar, yieldBox } =
            await register();

        const POOL = 10;
        const lqAssetId = await liquidationQueue.lqAssetId();

        // Bid
        await (await weth.freeMint(LQ_META.minBidAmount)).wait();
        await (
            await weth.approve(yieldBox.address, LQ_META.minBidAmount)
        ).wait();
        await yieldBox.depositAsset(
            lqAssetId,
            deployer.address,
            deployer.address,
            LQ_META.minBidAmount,
            0,
        );
        await yieldBox.setApprovalForAll(liquidationQueue.address, true);
        await liquidationQueue.bid(
            deployer.address,
            POOL,
            LQ_META.minBidAmount,
        );

        await expect(
            liquidationQueue.removeInactivatedBid(deployer.address, POOL),
        ).to.emit(liquidationQueue, 'RemoveBid');

        // Check for deleted bid pool entry queue
        expect(
            (await liquidationQueue.bidPools(POOL, deployer.address)).amount,
        ).to.be.eq(0);

        // Check for fund return
        expect(
            await yieldBox.toAmount(
                lqAssetId,
                await yieldBox.balanceOf(deployer.address, lqAssetId),
                false,
            ),
        ).to.be.eq(LQ_META.minBidAmount);
    });

    it('Should remove an activated bid', async () => {
        const {
            liquidationQueue,
            deployer,
            weth,
            LQ_META,
            bar,
            yieldBox,
            timeTravel,
        } = await register();

        const POOL = 10;
        const lqAssetId = await liquidationQueue.lqAssetId();

        // Bid and activate
        await (await weth.freeMint(LQ_META.minBidAmount)).wait();
        await (
            await weth.approve(yieldBox.address, LQ_META.minBidAmount)
        ).wait();

        await yieldBox.depositAsset(
            lqAssetId,
            deployer.address,
            deployer.address,
            LQ_META.minBidAmount,
            0,
        );
        await yieldBox.setApprovalForAll(liquidationQueue.address, true);
        await liquidationQueue.bid(
            deployer.address,
            POOL,
            LQ_META.minBidAmount,
        );
        await timeTravel(10_000);
        await liquidationQueue.activateBid(deployer.address, POOL);

        const bidIndexLen = await liquidationQueue.userBidIndexLength(
            deployer.address,
            POOL,
        );

        await expect(
            liquidationQueue.removeBid(
                deployer.address,
                POOL,
                bidIndexLen.sub(1),
            ),
        ).to.emit(liquidationQueue, 'RemoveBid');

        // Check for deleted bid pool entry queue
        expect(
            (await liquidationQueue.bidPools(POOL, deployer.address)).amount,
        ).to.be.eq(0);

        // Check for fund return
        expect(
            await yieldBox.toAmount(
                lqAssetId,
                await yieldBox.balanceOf(deployer.address, lqAssetId),
                false,
            ),
        ).to.be.eq(LQ_META.minBidAmount);
    });

    it('Should execute bids', async () => {
        const {
            deployer,
            eoa1,
            feeCollector,
            __wethUsdcPrice,
            liquidationQueue,
            LQ_META,
            weth,
            usdc,
            bar,
            yieldBox,
            wethUsdcMixologist,
            wethUsdcOracle,
            multiSwapper,
            BN,
            timeTravel,
        } = await register();

        const POOL = 5;
        const marketAssetId = await wethUsdcMixologist.assetId();
        const marketColId = await wethUsdcMixologist.collateralId();
        const lqAssetId = await liquidationQueue.lqAssetId();

        // Bid and activate
        await (await weth.freeMint(LQ_META.minBidAmount.mul(100))).wait();
        await (
            await weth.approve(yieldBox.address, LQ_META.minBidAmount.mul(100))
        ).wait();
        await yieldBox.depositAsset(
            lqAssetId,
            deployer.address,
            deployer.address,
            LQ_META.minBidAmount.mul(100),
            0,
        );
        await yieldBox.setApprovalForAll(liquidationQueue.address, true);
        await liquidationQueue.bid(
            deployer.address,
            POOL,
            LQ_META.minBidAmount.mul(100),
        );
        await timeTravel(10_000);
        await liquidationQueue.activateBid(deployer.address, POOL);

        // Mint some weth to deposit as asset with EOA1
        const wethAmount = BN(1e18).mul(100);
        await weth.connect(eoa1).freeMint(wethAmount);
        await weth.connect(eoa1).approve(yieldBox.address, wethAmount);

        await yieldBox
            .connect(eoa1)
            .depositAsset(
                marketAssetId,
                eoa1.address,
                eoa1.address,
                wethAmount,
                0,
            );

        await yieldBox
            .connect(eoa1)
            .setApprovalForAll(wethUsdcMixologist.address, true);
        await wethUsdcMixologist
            .connect(eoa1)
            .addAsset(
                eoa1.address,
                false,
                await yieldBox.toShare(marketAssetId, wethAmount, false),
            );

        // Mint some usdc to deposit as collateral and borrow with deployer
        const usdcAmount = wethAmount.mul(__wethUsdcPrice.div(BN(1e18)));
        const borrowAmount = usdcAmount
            .mul(74)
            .div(100)
            .div(__wethUsdcPrice.div(BN(1e18)));

        await usdc.freeMint(usdcAmount);
        await usdc.approve(yieldBox.address, usdcAmount);
        await yieldBox.depositAsset(
            marketColId,
            deployer.address,
            deployer.address,
            usdcAmount,
            0,
        );
        await yieldBox.setApprovalForAll(wethUsdcMixologist.address, true);
        await wethUsdcMixologist.addCollateral(
            deployer.address,
            false,
            await yieldBox.toShare(marketColId, usdcAmount, false),
        );
        await wethUsdcMixologist.borrow(deployer.address, borrowAmount);

        // Try to liquidate but with failure since price hasn't changed
        await expect(
            wethUsdcMixologist.liquidate(
                [deployer.address],
                [await wethUsdcMixologist.userBorrowPart(deployer.address)],
                ethers.constants.AddressZero,
            ),
        ).to.be.revertedWith('Mx: all are solvent');

        // Make some price movement and liquidate
        const priceDrop = __wethUsdcPrice.mul(5).div(100);
        await wethUsdcOracle.set(__wethUsdcPrice.add(priceDrop));
        await wethUsdcMixologist.updateExchangeRate();

        await expect(
            wethUsdcMixologist.liquidate(
                [deployer.address],
                [await wethUsdcMixologist.userBorrowPart(deployer.address)],
                multiSwapper.address,
            ),
        ).to.not.be.reverted;

        await expect(
            wethUsdcMixologist.liquidate(
                [deployer.address],
                [await wethUsdcMixologist.userBorrowPart(deployer.address)],
                multiSwapper.address,
            ),
        ).to.be.revertedWith('Mx: all are solvent');

        // Check that LQ balances has been added
        expect(await liquidationQueue.balancesDue(deployer.address)).to.not.eq(
            0,
        );
        await liquidationQueue.redeem(feeCollector.address);
        // Check LQ fees has been added after withdrawal
        expect(
            await liquidationQueue.balancesDue(feeCollector.address),
        ).to.not.eq(0);
    });

    it('should get the market', async () => {
        const { liquidationQueue, wethUsdcMixologist } = await register();

        const market = await liquidationQueue.market();
        const mixologistName = await wethUsdcMixologist.name();
        expect(market.length > 0).to.be.true;
        expect(market).to.eq(mixologistName);
    });

    it('should return order book entries', async () => {
        const {
            liquidationQueue,
            weth,
            LQ_META,
            yieldBox,
            deployer,
            timeTravel,
        } = await register();

        const orderBookEntries = await liquidationQueue.getOrderBookPoolEntries(
            0,
        );
        expect(orderBookEntries.length == 0).to.be.true;

        const POOL = 10;

        await (await weth.freeMint(LQ_META.minBidAmount.mul(2))).wait();
        await (
            await weth.approve(yieldBox.address, LQ_META.minBidAmount.mul(2))
        ).wait();
        await yieldBox.depositAsset(
            await liquidationQueue.lqAssetId(),
            deployer.address,
            deployer.address,
            LQ_META.minBidAmount.mul(2),
            0,
        );

        await yieldBox.setApprovalForAll(liquidationQueue.address, true);
        await expect(
            liquidationQueue.bid(deployer.address, POOL, LQ_META.minBidAmount),
        ).to.emit(liquidationQueue, 'Bid');

        await timeTravel(10_000);
        await expect(
            liquidationQueue.activateBid(deployer.address, POOL),
        ).to.emit(liquidationQueue, 'ActivateBid');

        const orderBookEntriesForExistingPool =
            await liquidationQueue.getOrderBookPoolEntries(POOL);
        expect(orderBookEntriesForExistingPool.length > 0).to.be.true;
    });

    it('should bid twice', async () => {
        const {
            liquidationQueue,
            weth,
            LQ_META,
            yieldBox,
            deployer,
            timeTravel,
        } = await register();

        const POOL = 10;

        await (await weth.freeMint(LQ_META.minBidAmount.mul(2))).wait();
        await (
            await weth.approve(yieldBox.address, LQ_META.minBidAmount.mul(2))
        ).wait();
        await yieldBox.depositAsset(
            await liquidationQueue.lqAssetId(),
            deployer.address,
            deployer.address,
            LQ_META.minBidAmount.mul(2),
            0,
        );

        await yieldBox.setApprovalForAll(liquidationQueue.address, true);
        await expect(
            liquidationQueue.bid(deployer.address, POOL, LQ_META.minBidAmount),
        ).to.emit(liquidationQueue, 'Bid');

        await timeTravel(10_000);
        await expect(
            liquidationQueue.activateBid(deployer.address, POOL),
        ).to.emit(liquidationQueue, 'ActivateBid');

        await yieldBox.setApprovalForAll(liquidationQueue.address, true);
        await expect(
            liquidationQueue.bid(deployer.address, POOL, LQ_META.minBidAmount),
        ).to.emit(liquidationQueue, 'Bid');

        await timeTravel(10_000);
        await expect(
            liquidationQueue.activateBid(deployer.address, POOL),
        ).to.emit(liquidationQueue, 'ActivateBid');
    });

    it('should check different flows using the 18 decimals test tokens', async () => {
        const poolId = 1;
        let accounts = await ethers.getSigners();
        const {
            yieldBox,
            liquidationQueue,
            wethUsdcMixologist,
            LQ_META,
            weth,
            usdc,
            __wethUsdcPrice,
            multiSwapper,
            wethUsdcOracle,
            timeTravel,
        } = await register();

        const mixologistAssetId = await wethUsdcMixologist.assetId();
        const mixologistCollateralId = await wethUsdcMixologist.collateralId();
        const lqAssetId = await liquidationQueue.lqAssetId();
        expect(lqAssetId, '✖️ Wrong asset id').to.eq(mixologistAssetId);
        expect(lqAssetId, '✖️ Wrong collateral id').to.not.eq(
            mixologistCollateralId,
        );

        const usdcMintVal = LQ_META.defaultBidAmount.mul(
            __wethUsdcPrice.div((1e18).toString()),
        );
        const usdcDepositVal = LQ_META.minBidAmount.mul(
            __wethUsdcPrice.div((1e18).toString()),
        );

        ///
        /// - get test funds
        ///
        for (let account of accounts) {
            await weth.connect(account).freeMint(LQ_META.defaultBidAmount); //for lending
            await usdc.connect(account).freeMint(usdcMintVal); //for collateral
        }

        const wethBalanceOfFirstAccount = parseFloat(
            ethers.utils.formatEther(await weth.balanceOf(accounts[0].address)),
        );
        const usdcBalanceOfFirstAccount = parseFloat(
            ethers.utils.formatEther(await weth.balanceOf(accounts[0].address)), //seems like the mock version of USDC has 18 decimals instead of 6
        );

        expect(wethBalanceOfFirstAccount, '✖️ WETH minting failed ').to.eq(
            parseFloat(ethers.utils.formatEther(LQ_META.defaultBidAmount)),
        );
        expect(usdcBalanceOfFirstAccount, '✖️ USDC minting failed').to.eq(
            parseFloat(ethers.utils.formatEther(LQ_META.defaultBidAmount)),
        );

        ///
        /// - deposit asset into the YieldBox
        ///
        for (let account of accounts) {
            const beforeDepositAmountOfAccount = await yieldBox.amountOf(
                account.address,
                lqAssetId,
            );
            expect(
                parseFloat(
                    ethers.utils.formatEther(beforeDepositAmountOfAccount),
                ),
                `✖️ Initial amount not right for account ${accounts.indexOf(
                    account,
                )}`,
            ).to.eq(0);

            await expect(
                yieldBox
                    .connect(account)
                    .depositAsset(
                        lqAssetId,
                        account.address,
                        account.address,
                        LQ_META.defaultBidAmount,
                        0,
                    ),
            ).to.be.reverted;

            await weth
                .connect(account)
                .approve(yieldBox.address, LQ_META.defaultBidAmount);

            await yieldBox
                .connect(account)
                .depositAsset(
                    lqAssetId,
                    account.address,
                    account.address,
                    LQ_META.defaultBidAmount,
                    0,
                );

            const amountOfAccount = await yieldBox.amountOf(
                account.address,
                lqAssetId,
            );
            expect(
                parseFloat(ethers.utils.formatEther(amountOfAccount)),
                `✖️ Amount not right for account ${accounts.indexOf(account)}`,
            ).to.eq(
                parseFloat(ethers.utils.formatEther(LQ_META.defaultBidAmount)),
            );
        }

        ///
        /// - place some bids, try to activate before time and remove inactive
        ///
        for (let account of accounts) {
            await expect(
                liquidationQueue
                    .connect(account)
                    .bid(account.address, poolId, LQ_META.minBidAmount),
            ).to.be.reverted;
            await expect(
                liquidationQueue
                    .connect(account)
                    .removeInactivatedBid(account.address, poolId),
            ).to.be.revertedWith('LQ: bid does not exist');

            await yieldBox
                .connect(account)
                .setApprovalForAll(liquidationQueue.address, true);
            await liquidationQueue
                .connect(account)
                .bid(account.address, poolId, LQ_META.minBidAmount);
            await expect(
                liquidationQueue
                    .connect(account)
                    .activateBid(account.address, poolId),
            ).to.be.revertedWith('LQ: too soon');

            const bidInfo = await liquidationQueue.bidPools(
                poolId,
                account.address,
            );
            expect(
                parseFloat(ethers.utils.formatEther(bidInfo.amount)),
                `✖️ Bid pool amount not right for account ${accounts.indexOf(
                    account,
                )}`,
            ).to.eq(parseFloat(ethers.utils.formatEther(LQ_META.minBidAmount)));

            await liquidationQueue
                .connect(account)
                .removeInactivatedBid(account.address, poolId);
        }

        const firstAccountYieldBoxBalanceBeforeBids = await yieldBox.toAmount(
            lqAssetId,
            await yieldBox.balanceOf(accounts[0].address, lqAssetId),
            false,
        );

        ///
        /// - place some bids, activate them, remove activated bid
        ///
        for (let account of accounts) {
            await expect(
                liquidationQueue
                    .connect(account)
                    .bid(account.address, poolId, LQ_META.minBidAmount),
            ).to.emit(liquidationQueue, 'Bid');
        }
        await timeTravel(600); //jump 10 mins to be able to activate bids
        for (let account of accounts) {
            await expect(
                liquidationQueue
                    .connect(account)
                    .activateBid(account.address, poolId),
            ).to.emit(liquidationQueue, 'ActivateBid');

            const bidInfo = await liquidationQueue.bidPools(
                poolId,
                account.address,
            );
            expect(parseFloat(ethers.utils.formatEther(bidInfo.amount))).to.eq(
                0,
            );

            const orderBookInfo = await liquidationQueue.orderBookInfos(poolId);
            const orderBookEntry = await liquidationQueue.orderBookEntries(
                poolId,
                orderBookInfo.nextBidPush - 1,
            );

            expect(
                orderBookEntry.bidder.toLowerCase(),
                `✖️ Bidder address not right for account ${accounts.indexOf(
                    account,
                )}`,
            ).to.eq(account.address.toLowerCase());

            expect(
                parseFloat(
                    ethers.utils.formatEther(orderBookEntry.bidInfo.amount),
                ),
                `✖️ Activated bid amount not right for account ${accounts.indexOf(
                    account,
                )}`,
            ).to.eq(parseFloat(ethers.utils.formatEther(LQ_META.minBidAmount)));
        }

        for (let account of accounts) {
            const userBidsLength = await liquidationQueue
                .connect(account)
                .userBidIndexLength(account.address, poolId);

            await expect(
                liquidationQueue
                    .connect(account)
                    .removeBid(account.address, poolId, userBidsLength.sub(1)),
            ).to.emit(liquidationQueue, 'RemoveBid');

            expect(
                (await liquidationQueue.bidPools(poolId, account.address))
                    .amount,
            ).to.be.eq(0);
        }

        const firstAccountYieldBoxBalanceAfterBids = await yieldBox.toAmount(
            lqAssetId,
            await yieldBox.balanceOf(accounts[0].address, lqAssetId),
            false,
        );
        expect(
            parseFloat(
                ethers.utils.formatEther(firstAccountYieldBoxBalanceBeforeBids),
            ),
            `✖️ Balance not right after removing the active bid`,
        ).to.eq(
            parseFloat(
                ethers.utils.formatEther(firstAccountYieldBoxBalanceAfterBids),
            ),
        );

        //should be 0 as no bid was executed
        const firstUserBalanceDue = await liquidationQueue.balancesDue(
            accounts[0].address,
        );
        expect(firstUserBalanceDue, `✖️ Due for first user not right`).to.eq(0);

        ///
        /// - split accounts into 2 groups (first lends, the 2nd one borrows), place bids, change collateral price, execute bids
        ///
        if (accounts.length > 1) {
            const arrays = splitArray(accounts, 2);
            let firstHalf = arrays[0];
            let secondHalf = arrays[1];

            if (firstHalf.length < secondHalf.length) {
                //make sure there's enough for borrowing
                const temp = firstHalf;
                firstHalf = secondHalf;
                secondHalf = temp;
            }

            //place bids
            for (let account of accounts) {
                await liquidationQueue
                    .connect(account)
                    .bid(account.address, poolId, LQ_META.minBidAmount);
            }
            //jump over the min activation period
            timeTravel(600);
            //activate bids
            for (let account of accounts) {
                await liquidationQueue
                    .connect(account)
                    .activateBid(account.address, poolId);
            }
            //first half lends the asset
            const lendValShare = await yieldBox.toShare(
                mixologistAssetId,
                LQ_META.minBidAmount,
                false,
            );
            for (let account of firstHalf) {
                const mixologistBalanceOfAccountBefore =
                    await wethUsdcMixologist.balanceOf(account.address);
                await expect(
                    mixologistBalanceOfAccountBefore,
                    `✖️ Account ${firstHalf.indexOf(
                        account,
                    )} mixologist balance before is not right`,
                ).to.eq(0);

                await yieldBox
                    .connect(account)
                    .setApprovalForAll(wethUsdcMixologist.address, true);

                await wethUsdcMixologist
                    .connect(account)
                    .addAsset(account.address, false, lendValShare);

                const mixologistBalanceOfAccountAfter =
                    await wethUsdcMixologist.balanceOf(account.address);

                await expect(
                    parseFloat(
                        ethers.utils.formatEther(
                            mixologistBalanceOfAccountAfter,
                        ),
                    ),
                    `✖️ Account ${firstHalf.indexOf(
                        account,
                    )} mixologist balance after lend operation is not right`,
                ).to.eq(parseFloat(ethers.utils.formatEther(lendValShare)));
            }
            //second half borrows
            const borrowVal = usdcDepositVal
                .mul(74)
                .div(100)
                .div(__wethUsdcPrice.div((1e18).toString())); // We borrow 74% collateral, max is 75%
            for (let account of secondHalf) {
                //we don't use skim; need yieldbox balance
                await usdc
                    .connect(account)
                    .approve(yieldBox.address, usdcDepositVal);
                await yieldBox
                    .connect(account)
                    .depositAsset(
                        mixologistCollateralId,
                        account.address,
                        account.address,
                        usdcDepositVal,
                        0,
                    );
                //register collateral
                await yieldBox
                    .connect(account)
                    .setApprovalForAll(wethUsdcMixologist.address, true);
                const collateralShare = await yieldBox.toShare(
                    mixologistCollateralId,
                    usdcDepositVal,
                    false,
                );
                await wethUsdcMixologist
                    .connect(account)
                    .addCollateral(account.address, false, collateralShare);

                await wethUsdcMixologist
                    .connect(account)
                    .borrow(account.address, borrowVal);

                // Can't liquidate yet
                await expect(
                    wethUsdcMixologist.liquidate(
                        [account.address],
                        [borrowVal],
                        multiSwapper.address,
                    ),
                ).to.be.reverted;
            }

            //simulate a price drop
            const priceDrop = __wethUsdcPrice.mul(2).div(100);
            await wethUsdcOracle.set(__wethUsdcPrice.add(priceDrop));

            //liquidate accounts
            const liqudatableAccounts = secondHalf.map(
                (el: SignerWithAddress) => el.address,
            );
            const liquidatebleAmonts = Array.from(
                { length: liqudatableAccounts.length },
                (_) => borrowVal,
            );

            const shareForCallerBefore = await yieldBox.balanceOf(
                accounts[0].address,
                lqAssetId,
            );

            await wethUsdcMixologist
                .connect(accounts[0])
                .liquidate(
                    liqudatableAccounts,
                    liquidatebleAmonts,
                    multiSwapper.address,
                );
            const shareForCallerAfter = await yieldBox.balanceOf(
                accounts[0].address,
                lqAssetId,
            );

            await expect(
                parseFloat(shareForCallerAfter.toString()),
                `✖️ After liquidation shares not right`,
            ).to.be.greaterThan(parseFloat(shareForCallerBefore.toString()));

            //redeem if everything is left
            for (let account of secondHalf) {
                const dueAmount = await liquidationQueue.balancesDue(
                    account.address,
                );
                if (dueAmount.gt(0)) {
                    const balanceBeforeRedeem = await yieldBox.balanceOf(
                        account.address,
                        mixologistCollateralId,
                    );
                    await expect(
                        liquidationQueue
                            .connect(account)
                            .redeem(account.address),
                    ).to.emit(liquidationQueue, 'Redeem');
                    const balanceAfterRedeem = await yieldBox.balanceOf(
                        account.address,
                        mixologistCollateralId,
                    );
                    await expect(
                        parseFloat(balanceAfterRedeem.toString()),
                        `✖️ After redeem shares not right`,
                    ).to.be.greaterThan(
                        parseFloat(balanceBeforeRedeem.toString()),
                    );
                }
            }
        }
    });

    it('should now allow bid on uninitialized contract', async () => {
        const { deployer, LQ_META } = await register();

        const liquidationQueueTest = await (
            await ethers.getContractFactory('LiquidationQueue')
        ).deploy();
        await liquidationQueueTest.deployed();

        await expect(
            liquidationQueueTest.bid(
                deployer.address,
                10,
                LQ_META.minBidAmount,
            ),
        ).to.be.revertedWith('LQ: Not initialized');
    });

    it('should not allow setting bid swapper from not authorized account ', async () => {
        const { liquidationQueue } = await register();

        await expect(
            liquidationQueue.setBidSwapper(ethers.constants.AddressZero),
        ).to.be.revertedWith('unauthorized');
    });

    it('should not allow initializing LQ twice', async () => {
        const { liquidationQueue, deployer } = await register();

        const LQ_META = {
            activationTime: 600, // 10min
            minBidAmount: ethers.BigNumber.from((1e18).toString()).mul(200), // 200 USDC
            defaultBidAmount: ethers.BigNumber.from((1e18).toString()).mul(400), // 400 USDC
            feeCollector: deployer.address,
            bidSwapper: ethers.constants.AddressZero,
        };
        await expect(liquidationQueue.init(LQ_META)).to.be.revertedWith(
            'LQ: Initialized',
        );
    });

    it('sould not be able to redeem without a balance', async () => {
        const { liquidationQueue, deployer } = await register();

        await expect(
            liquidationQueue.redeem(deployer.address),
        ).to.be.revertedWith('LQ: No balance due');
    });

    it('should not allow bid execution from EOA', async () => {
        const { liquidationQueue, BN } = await register();

        await expect(
            liquidationQueue.executeBids(BN(1e18).toString()),
        ).to.be.revertedWith('LQ: Only Mixologist');
    });

    it('should bid with USDC through external swapper - USDC->WETH>collateral', async () => {
        const {
            deployer,
            bar,
            yieldBox,
            liquidationQueue,
            wethUsdcMixologist,
            usdc,
            weth,
            wethAssetId,
            usdcAssetId,
            LQ_META,
            multiSwapper,
            BN,
        } = await register();

        //deploy and register UniswapWethHopBidder
        const uniWethHopBidder = await (
            await ethers.getContractFactory('UniswapWethHopBidder')
        ).deploy(multiSwapper.address, wethUsdcMixologist.address, wethAssetId);
        await uniWethHopBidder.deployed();

        await expect(
            uniWethHopBidder.swap(
                deployer.address,
                usdcAssetId,
                BN(1e18).toString(),
                ethers.utils.toUtf8Bytes(''),
            ),
        ).to.be.revertedWith('only LQ');

        const updateLQSwapperFnInterface = new ethers.utils.Interface([
            'function updateLiquidationQueueSwapper(address)',
        ]);
        const fnData = updateLQSwapperFnInterface.encodeFunctionData(
            'updateLiquidationQueueSwapper',
            [uniWethHopBidder.address],
        );
        await bar.executeMixologistFn([wethUsdcMixologist.address], [fnData]);

        const savedBidSwapper = (await liquidationQueue.liquidationQueueMeta())
            .bidSwapper;
        expect(savedBidSwapper.toLowerCase()).to.eq(
            uniWethHopBidder.address.toLowerCase(),
        );

        /// --- Acts ----
        const POOL = 10;
        const lqMeta = await liquidationQueue.liquidationQueueMeta();
        expect(lqMeta.bidSwapper).to.not.eq(ethers.constants.AddressZero);

        const bidSwapperContract = await ethers.getContractAt(
            'IStableBidder',
            lqMeta.bidSwapper,
        );

        const testOutputAmount = await bidSwapperContract.getOutputAmount(
            usdcAssetId,
            BN(1e18).mul(1000),
            ethers.utils.toUtf8Bytes(''),
        );
        expect(testOutputAmount.gt(BN(1e18).mul(9))).to.be.true;

        await usdc.freeMint(LQ_META.defaultBidAmount);
        await usdc.approve(yieldBox.address, LQ_META.defaultBidAmount);
        await yieldBox.depositAsset(
            usdcAssetId,
            deployer.address,
            deployer.address,
            LQ_META.defaultBidAmount,
            0,
        );

        await yieldBox.setApprovalForAll(lqMeta.bidSwapper, true);
        const data = new ethers.utils.AbiCoder().encode(
            ['uint256', 'uint256'],
            [LQ_META.minBidAmount.div(1e3), LQ_META.minBidAmount],
        );
        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                POOL,
                usdcAssetId,
                LQ_META.minBidAmount,
                new ethers.utils.AbiCoder().encode(
                    ['uint256', 'uint256'],
                    [0, 0],
                ),
            ),
        ).to.be.revertedWith('LQ: bid too low');

        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                POOL,
                usdcAssetId,
                LQ_META.defaultBidAmount,
                new ethers.utils.AbiCoder().encode(
                    ['uint256', 'uint256'],
                    [
                        LQ_META.defaultBidAmount.mul(10),
                        LQ_META.defaultBidAmount.mul(10),
                    ],
                ),
            ),
        ).to.be.revertedWith('insufficient-amount-out');

        const usdcShareAmount = await yieldBox.toShare(
            usdcAssetId,
            LQ_META.defaultBidAmount,
            false,
        );
        const wethAmount = await multiSwapper.getOutputAmount(
            usdcAssetId,
            [usdc.address, weth.address],
            usdcShareAmount,
        );
        const wethShare = await yieldBox.toShare(
            wethAssetId,
            wethAmount,
            false,
        );
        const outAmount = await multiSwapper.getOutputAmount(
            wethAssetId,
            [weth.address, usdc.address],
            wethShare,
        );

        const testingUsdoToUsdcAmount = await uniWethHopBidder.getOutputAmount(
            usdcAssetId,
            LQ_META.defaultBidAmount,
            ethers.utils.toUtf8Bytes(''),
        );
        expect(testingUsdoToUsdcAmount.gt(LQ_META.minBidAmount));
        expect(testingUsdoToUsdcAmount.lte(LQ_META.defaultBidAmount));

        await expect(
            uniWethHopBidder.setUniswapSwapper(multiSwapper.address),
        ).to.emit(uniWethHopBidder, 'UniV2SwapperUpdated');

        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                POOL,
                usdcAssetId,
                LQ_META.defaultBidAmount,
                data,
            ),
        ).to.emit(liquidationQueue, 'Bid');
        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                9999999,
                usdcAssetId,
                LQ_META.defaultBidAmount,
                data,
            ),
        ).to.be.revertedWith('LQ: premium too high');

        const bidPoolInfo = await liquidationQueue.bidPools(
            POOL,
            deployer.address,
        );
        expect(bidPoolInfo[0].gt(LQ_META.minBidAmount)).to.be.true;
        expect(bidPoolInfo[0].lte(LQ_META.defaultBidAmount)).to.be.true;
    });

    it('should bid with USD0 through external swapper - USD0->WETH>collateral', async () => {
        const {
            deployer,
            bar,
            yieldBox,
            liquidationQueue,
            wethUsdcMixologist,
            usdc,
            weth,
            wethAssetId,
            LQ_META,
            multiSwapper,
            __uniFactory,
            __uniRouter,
            __wethUsdcPrice,
            BN,
        } = await register();

        /// --- Setup ---
        //deploy and register USD0
        const usdo = await (
            await ethers.getContractFactory('ERC20Mock')
        ).deploy(BN(1e18).mul(1e9).toString());
        await usdo.deployed();

        const assetsLengthBefore = await yieldBox.assetCount();
        await bar.setUsdoToken(usdo.address);
        const usdoAssetId = await yieldBox.ids(
            1,
            usdo.address,
            ethers.constants.AddressZero,
            0,
        );

        //deploy and register UniswapWethHopBidder
        const uniWethHopBidder = await (
            await ethers.getContractFactory('UniswapWethHopBidder')
        ).deploy(multiSwapper.address, wethUsdcMixologist.address, wethAssetId);
        await uniWethHopBidder.deployed();

        await expect(
            uniWethHopBidder.swap(
                deployer.address,
                usdoAssetId,
                BN(1e18).toString(),
                ethers.utils.toUtf8Bytes(''),
            ),
        ).to.be.revertedWith('only LQ');

        const updateLQSwapperFnInterface = new ethers.utils.Interface([
            'function updateLiquidationQueueSwapper(address)',
        ]);
        const fnData = updateLQSwapperFnInterface.encodeFunctionData(
            'updateLiquidationQueueSwapper',
            [uniWethHopBidder.address],
        );
        await bar.executeMixologistFn([wethUsdcMixologist.address], [fnData]);

        const assetsLengthAfter = await yieldBox.assetCount();
        expect(assetsLengthAfter.sub(1).eq(assetsLengthBefore)).to.be.true;
        expect(usdoAssetId.add(1).eq(assetsLengthAfter)).to.be.true;

        const savedBidSwapper = (await liquidationQueue.liquidationQueueMeta())
            .bidSwapper;
        expect(savedBidSwapper.toLowerCase()).to.eq(
            uniWethHopBidder.address.toLowerCase(),
        );

        //setup univ2 enviroment for weth <> usdo pair
        const wethLiquidity = ethers.BigNumber.from(1e6).mul((1e18).toString());
        const usdoLiquidity = wethLiquidity.mul(
            __wethUsdcPrice.div((1e18).toString()),
        );

        await weth.freeMint(wethLiquidity);
        await usdo.freeMint(usdoLiquidity);

        await __uniFactory.createPair(usdo.address, weth.address);
        await usdo.approve(__uniRouter.address, usdoLiquidity);
        await weth.approve(__uniRouter.address, wethLiquidity);
        await __uniRouter.addLiquidity(
            usdo.address,
            weth.address,
            usdoLiquidity,
            wethLiquidity,
            usdoLiquidity,
            wethLiquidity,
            deployer.address,
            Math.floor(Date.now() / 1000) + 1000 * 60, // 1min margin
        );

        /// --- Acts ----
        const POOL = 10;
        const lqMeta = await liquidationQueue.liquidationQueueMeta();
        expect(lqMeta.bidSwapper).to.not.eq(ethers.constants.AddressZero);

        const bidSwapperContract = await ethers.getContractAt(
            'IStableBidder',
            lqMeta.bidSwapper,
        );

        const bidSwapperName = await bidSwapperContract.name();
        expect(bidSwapperName).to.eq(
            'stable -> WETH (Uniswap V2) / WETH -> tAsset (Uniswap V2)',
        );

        const testOutputAmount = await bidSwapperContract.getOutputAmount(
            usdoAssetId,
            BN(1e18).mul(1000),
            ethers.utils.toUtf8Bytes(''),
        );
        expect(testOutputAmount.gt(BN(1e18).mul(9))).to.be.true;

        let yieldBoxBalanceOfUsdoShare = await yieldBox.balanceOf(
            deployer.address,
            usdoAssetId,
        );
        expect(yieldBoxBalanceOfUsdoShare.eq(0)).to.be.true;

        await usdo.freeMint(LQ_META.defaultBidAmount);
        await usdo.approve(yieldBox.address, LQ_META.defaultBidAmount);
        await yieldBox.depositAsset(
            usdoAssetId,
            deployer.address,
            deployer.address,
            LQ_META.defaultBidAmount,
            0,
        );
        yieldBoxBalanceOfUsdoShare = await yieldBox.balanceOf(
            deployer.address,
            usdoAssetId,
        );
        const yieldBoxAmount = await yieldBox.toAmount(
            usdoAssetId,
            yieldBoxBalanceOfUsdoShare,
            false,
        );
        expect(yieldBoxAmount.eq(LQ_META.defaultBidAmount)).to.be.true;

        await yieldBox.setApprovalForAll(lqMeta.bidSwapper, true);
        const data = new ethers.utils.AbiCoder().encode(
            ['uint256', 'uint256'],
            [LQ_META.minBidAmount.div(1e3), LQ_META.minBidAmount],
        );
        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                POOL,
                usdoAssetId,
                LQ_META.minBidAmount,
                new ethers.utils.AbiCoder().encode(
                    ['uint256', 'uint256'],
                    [0, 0],
                ),
            ),
        ).to.be.revertedWith('LQ: bid too low');

        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                POOL,
                usdoAssetId,
                LQ_META.defaultBidAmount,
                new ethers.utils.AbiCoder().encode(
                    ['uint256', 'uint256'],
                    [
                        LQ_META.defaultBidAmount.mul(10),
                        LQ_META.defaultBidAmount.mul(10),
                    ],
                ),
            ),
        ).to.be.revertedWith('insufficient-amount-out');

        const usdoShareAmount = await yieldBox.toShare(
            usdoAssetId,
            LQ_META.defaultBidAmount,
            false,
        );
        const wethAmount = await multiSwapper.getOutputAmount(
            usdoAssetId,
            [usdo.address, weth.address],
            usdoShareAmount,
        );
        const wethShare = await yieldBox.toShare(
            wethAssetId,
            wethAmount,
            false,
        );
        const outAmount = await multiSwapper.getOutputAmount(
            wethAssetId,
            [weth.address, usdc.address],
            wethShare,
        );

        const testingUsdoToUsdcAmount = await uniWethHopBidder.getOutputAmount(
            usdoAssetId,
            LQ_META.defaultBidAmount,
            ethers.utils.toUtf8Bytes(''),
        );
        expect(testingUsdoToUsdcAmount.gt(LQ_META.minBidAmount));
        expect(testingUsdoToUsdcAmount.lte(LQ_META.defaultBidAmount));

        await expect(
            uniWethHopBidder.setUniswapSwapper(multiSwapper.address),
        ).to.emit(uniWethHopBidder, 'UniV2SwapperUpdated');

        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                POOL,
                usdoAssetId,
                LQ_META.defaultBidAmount,
                data,
            ),
        ).to.emit(liquidationQueue, 'Bid');
        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                9999999,
                usdoAssetId,
                LQ_META.defaultBidAmount,
                data,
            ),
        ).to.be.revertedWith('LQ: premium too high');

        const bidPoolInfo = await liquidationQueue.bidPools(
            POOL,
            deployer.address,
        );
        expect(bidPoolInfo[0].gt(LQ_META.minBidAmount)).to.be.true;
        expect(bidPoolInfo[0].lte(outAmount)).to.be.true;
    });

    it('should bid with USD0 through external swapper - USD0>collateral', async () => {
        const {
            deployer,
            bar,
            yieldBox,
            liquidationQueue,
            wethUsdcMixologist,
            usdc,
            weth,
            wethAssetId,
            LQ_META,
            multiSwapper,
            __uniFactory,
            __uniRouter,
            BN,
        } = await register();

        /// --- Setup ----

        //deploy and register USD0
        const usdo = await (
            await ethers.getContractFactory('ERC20Mock')
        ).deploy(BN(1e18).mul(1e9).toString());
        await usdo.deployed();

        const assetsLengthBefore = await yieldBox.assetCount();
        await bar.setUsdoToken(usdo.address);
        const usdoAssetId = await yieldBox.ids(
            1,
            usdo.address,
            ethers.constants.AddressZero,
            0,
        );

        //create USD0->USDC bidder
        const curvePoolMock = await (
            await ethers.getContractFactory('CurvePoolMock')
        ).deploy(usdo.address, weth.address);
        const curveSwapper = await (
            await ethers.getContractFactory('CurveSwapper')
        ).deploy(curvePoolMock.address, bar.address);

        const usdoHopBidder = await (
            await ethers.getContractFactory('UsdoHopBidder')
        ).deploy(
            multiSwapper.address,
            curveSwapper.address,
            wethUsdcMixologist.address,
            2,
        );
        await usdoHopBidder.deployed();

        await expect(
            usdoHopBidder.swap(
                deployer.address,
                usdoAssetId,
                BN(1e18).toString(),
                ethers.utils.toUtf8Bytes(''),
            ),
        ).to.be.revertedWith('only LQ');

        //register bid swapper
        const updateLQSwapperFnInterface = new ethers.utils.Interface([
            'function updateLiquidationQueueSwapper(address)',
        ]);
        const fnData = updateLQSwapperFnInterface.encodeFunctionData(
            'updateLiquidationQueueSwapper',
            [usdoHopBidder.address],
        );
        await bar.executeMixologistFn([wethUsdcMixologist.address], [fnData]);

        //set swappers on usdoHopBidder
        const assetsLengthAfter = await yieldBox.assetCount();
        expect(assetsLengthAfter.sub(1).eq(assetsLengthBefore)).to.be.true;
        expect(usdoAssetId.add(1).eq(assetsLengthAfter)).to.be.true;

        const savedBidSwapper = (await liquidationQueue.liquidationQueueMeta())
            .bidSwapper;
        expect(savedBidSwapper.toLowerCase()).to.eq(
            usdoHopBidder.address.toLowerCase(),
        );

        //setup univ2 enviroment for usdc <> usdo pair
        const uniV2LiquidityAsset = BN(1e18).mul(1e6).toString();
        await __uniFactory.createPair(usdo.address, usdc.address);

        await usdc.freeMint(uniV2LiquidityAsset);
        await usdo.freeMint(uniV2LiquidityAsset);

        await usdo.approve(__uniRouter.address, uniV2LiquidityAsset);
        await usdc.approve(__uniRouter.address, uniV2LiquidityAsset);
        await __uniRouter.addLiquidity(
            usdo.address,
            usdc.address,
            uniV2LiquidityAsset,
            uniV2LiquidityAsset,
            uniV2LiquidityAsset,
            uniV2LiquidityAsset,
            deployer.address,
            Math.floor(Date.now() / 1000) + 1000 * 60, // 1min margin
        );

        /// --- Acts ----
        const POOL = 10;
        const lqMeta = await liquidationQueue.liquidationQueueMeta();
        expect(lqMeta.bidSwapper).to.not.eq(ethers.constants.AddressZero);

        const bidSwapperContract = await ethers.getContractAt(
            'IStableBidder',
            lqMeta.bidSwapper,
        );

        const bidSwapperName = await bidSwapperContract.name();
        expect(bidSwapperName).to.eq(
            'stable -> USD0 (3Crv+USD0) / USD0 -> tAsset (Uniswap V2)',
        );

        const testOutputAmount = await bidSwapperContract.getOutputAmount(
            usdoAssetId,
            BN(1e18).mul(10),
            ethers.utils.toUtf8Bytes(''),
        );
        expect(testOutputAmount.gt(BN(1e18).mul(9))).to.be.true;

        let yieldBoxBalanceOfUsdoShare = await yieldBox.balanceOf(
            deployer.address,
            usdoAssetId,
        );
        expect(yieldBoxBalanceOfUsdoShare.eq(0)).to.be.true;

        await usdo.freeMint(LQ_META.defaultBidAmount);
        await usdo.approve(yieldBox.address, LQ_META.defaultBidAmount);
        await yieldBox.depositAsset(
            usdoAssetId,
            deployer.address,
            deployer.address,
            LQ_META.defaultBidAmount,
            0,
        );
        yieldBoxBalanceOfUsdoShare = await yieldBox.balanceOf(
            deployer.address,
            usdoAssetId,
        );
        const yieldBoxAmount = await yieldBox.toAmount(
            usdoAssetId,
            yieldBoxBalanceOfUsdoShare,
            false,
        );
        expect(yieldBoxAmount.eq(LQ_META.defaultBidAmount)).to.be.true;

        await yieldBox.setApprovalForAll(lqMeta.bidSwapper, true);
        const data = new ethers.utils.AbiCoder().encode(
            ['uint256', 'uint256'],
            [LQ_META.minBidAmount.div(1e3), LQ_META.minBidAmount],
        );
        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                POOL,
                usdoAssetId,
                LQ_META.minBidAmount,
                new ethers.utils.AbiCoder().encode(
                    ['uint256', 'uint256'],
                    [0, 0],
                ),
            ),
        ).to.be.revertedWith('LQ: bid too low');

        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                POOL,
                usdoAssetId,
                LQ_META.defaultBidAmount,
                new ethers.utils.AbiCoder().encode(
                    ['uint256', 'uint256'],
                    [
                        LQ_META.defaultBidAmount.mul(10),
                        LQ_META.defaultBidAmount.mul(10),
                    ],
                ),
            ),
        ).to.be.revertedWith('insufficient-amount-out');

        const testingUsdoToUsdcAmount = await usdoHopBidder.getOutputAmount(
            usdoAssetId,
            LQ_META.defaultBidAmount,
            ethers.utils.toUtf8Bytes(''),
        );
        expect(testingUsdoToUsdcAmount.gt(LQ_META.minBidAmount));
        expect(testingUsdoToUsdcAmount.lte(LQ_META.defaultBidAmount));

        await expect(
            usdoHopBidder.setCurveSwapper(curveSwapper.address),
        ).to.emit(usdoHopBidder, 'CurveSwapperUpdated');
        await expect(
            usdoHopBidder.setUniswapSwapper(multiSwapper.address),
        ).to.emit(usdoHopBidder, 'UniV2SwapperUpdated');

        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                POOL,
                usdoAssetId,
                LQ_META.defaultBidAmount,
                data,
            ),
        ).to.emit(liquidationQueue, 'Bid');
        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                9999999,
                usdoAssetId,
                LQ_META.defaultBidAmount,
                data,
            ),
        ).to.be.revertedWith('LQ: premium too high');

        const bidPoolInfo = await liquidationQueue.bidPools(
            POOL,
            deployer.address,
        );
        expect(bidPoolInfo[0].gt(LQ_META.minBidAmount)).to.be.true;
        expect(bidPoolInfo[0].lte(LQ_META.defaultBidAmount)).to.be.true;
    });

    it('should bid with USDC through external swapper - USDC>USD0>collateral', async () => {
        const {
            deployer,
            bar,
            yieldBox,
            liquidationQueue,
            wethUsdcMixologist,
            usdc,
            weth,
            usdcAssetId,
            LQ_META,
            multiSwapper,
            __uniFactory,
            __uniRouter,
            BN,
        } = await register();

        /// --- Setup ----

        //deploy and register USD0
        const usdo = await (
            await ethers.getContractFactory('ERC20Mock')
        ).deploy(BN(1e18).mul(1e9).toString());
        await usdo.deployed();

        const assetsLengthBefore = await yieldBox.assetCount();
        await bar.setUsdoToken(usdo.address);
        const usdoAssetId = await yieldBox.ids(
            1,
            usdo.address,
            ethers.constants.AddressZero,
            0,
        );

        //create USDC->USD0->collateral bidder
        const curvePoolMock = await (
            await ethers.getContractFactory('CurvePoolMock')
        ).deploy(usdc.address, usdo.address);
        const curveSwapper = await (
            await ethers.getContractFactory('CurveSwapper')
        ).deploy(curvePoolMock.address, bar.address);

        const usdoHopBidder = await (
            await ethers.getContractFactory('UsdoHopBidder')
        ).deploy(
            multiSwapper.address,
            curveSwapper.address,
            wethUsdcMixologist.address,
            2,
        );
        await usdoHopBidder.deployed();

        await expect(
            usdoHopBidder.swap(
                deployer.address,
                usdoAssetId,
                BN(1e18).toString(),
                ethers.utils.toUtf8Bytes(''),
            ),
        ).to.be.revertedWith('only LQ');

        //register bid swapper
        const updateLQSwapperFnInterface = new ethers.utils.Interface([
            'function updateLiquidationQueueSwapper(address)',
        ]);
        const fnData = updateLQSwapperFnInterface.encodeFunctionData(
            'updateLiquidationQueueSwapper',
            [usdoHopBidder.address],
        );
        await bar.executeMixologistFn([wethUsdcMixologist.address], [fnData]);

        //set swappers on usdoHopBidder
        const assetsLengthAfter = await yieldBox.assetCount();
        expect(assetsLengthAfter.sub(1).eq(assetsLengthBefore)).to.be.true;
        expect(usdoAssetId.add(1).eq(assetsLengthAfter)).to.be.true;

        const savedBidSwapper = (await liquidationQueue.liquidationQueueMeta())
            .bidSwapper;
        expect(savedBidSwapper.toLowerCase()).to.eq(
            usdoHopBidder.address.toLowerCase(),
        );

        //setup univ2 enviroment for usdc <> usdo pair
        const uniV2LiquidityAsset = BN(1e18).mul(1e6).toString();
        await __uniFactory.createPair(usdo.address, usdc.address);

        await usdc.freeMint(uniV2LiquidityAsset);
        await usdo.freeMint(uniV2LiquidityAsset);

        await usdo.approve(__uniRouter.address, uniV2LiquidityAsset);
        await usdc.approve(__uniRouter.address, uniV2LiquidityAsset);
        await __uniRouter.addLiquidity(
            usdo.address,
            usdc.address,
            uniV2LiquidityAsset,
            uniV2LiquidityAsset,
            uniV2LiquidityAsset,
            uniV2LiquidityAsset,
            deployer.address,
            Math.floor(Date.now() / 1000) + 1000 * 60, // 1min margin
        );

        /// --- Acts ----
        const POOL = 10;
        const lqMeta = await liquidationQueue.liquidationQueueMeta();
        expect(lqMeta.bidSwapper).to.not.eq(ethers.constants.AddressZero);

        const bidSwapperContract = await ethers.getContractAt(
            'IStableBidder',
            lqMeta.bidSwapper,
        );

        const bidSwapperName = await bidSwapperContract.name();
        expect(bidSwapperName).to.eq(
            'stable -> USD0 (3Crv+USD0) / USD0 -> tAsset (Uniswap V2)',
        );

        const testOutputAmount = await bidSwapperContract.getOutputAmount(
            usdcAssetId,
            BN(1e18).mul(10),
            ethers.utils.toUtf8Bytes(''),
        );
        expect(testOutputAmount.gt(BN(1e18).mul(9))).to.be.true;

        await usdc.freeMint(LQ_META.defaultBidAmount);
        await usdc.approve(yieldBox.address, LQ_META.defaultBidAmount);
        await yieldBox.depositAsset(
            usdcAssetId,
            deployer.address,
            deployer.address,
            LQ_META.defaultBidAmount,
            0,
        );

        await yieldBox.setApprovalForAll(lqMeta.bidSwapper, true);
        const data = new ethers.utils.AbiCoder().encode(
            ['uint256', 'uint256'],
            [LQ_META.minBidAmount, LQ_META.minBidAmount],
        );
        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                POOL,
                usdcAssetId,
                LQ_META.minBidAmount,
                new ethers.utils.AbiCoder().encode(
                    ['uint256', 'uint256'],
                    [0, 0],
                ),
            ),
        ).to.be.revertedWith('LQ: bid too low');

        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                POOL,
                usdcAssetId,
                LQ_META.defaultBidAmount,
                new ethers.utils.AbiCoder().encode(
                    ['uint256', 'uint256'],
                    [
                        LQ_META.defaultBidAmount.mul(10),
                        LQ_META.defaultBidAmount.mul(10),
                    ],
                ),
            ),
        ).to.be.revertedWith('insufficient-amount-out');
        await curvePoolMock.setDivider(0);
        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                POOL,
                usdcAssetId,
                LQ_META.defaultBidAmount,
                new ethers.utils.AbiCoder().encode(
                    ['uint256', 'uint256'],
                    [0, 0],
                ),
            ),
        ).to.be.revertedWith('swap failed');
        await curvePoolMock.setDivider(1);
        const testingUsdcToCollateralAmount =
            await usdoHopBidder.getOutputAmount(
                usdcAssetId,
                LQ_META.defaultBidAmount,
                ethers.utils.toUtf8Bytes(''),
            );
        expect(testingUsdcToCollateralAmount.gt(LQ_META.minBidAmount));
        expect(testingUsdcToCollateralAmount.lte(LQ_META.defaultBidAmount));

        await expect(
            usdoHopBidder.setCurveSwapper(curveSwapper.address),
        ).to.emit(usdoHopBidder, 'CurveSwapperUpdated');
        await expect(
            usdoHopBidder.setUniswapSwapper(multiSwapper.address),
        ).to.emit(usdoHopBidder, 'UniV2SwapperUpdated');

        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                POOL,
                usdcAssetId,
                LQ_META.defaultBidAmount,
                data,
            ),
        ).to.emit(liquidationQueue, 'Bid');
        await expect(
            liquidationQueue.bidWithStable(
                deployer.address,
                9999999,
                usdcAssetId,
                LQ_META.defaultBidAmount,
                data,
            ),
        ).to.be.revertedWith('LQ: premium too high');

        const bidPoolInfo = await liquidationQueue.bidPools(
            POOL,
            deployer.address,
        );
        expect(bidPoolInfo[0].gt(LQ_META.minBidAmount)).to.be.true;
        expect(bidPoolInfo[0].lte(LQ_META.defaultBidAmount)).to.be.true;
    });
});

//TODO: move to utils if needed in other places
const splitArray = (arr: any, batches: number) => {
    var chunkLength = Math.max(arr.length / batches, 1);
    var chunks = [];
    for (var i = 0; i < batches; i++) {
        if (chunkLength * (i + 1) <= arr.length)
            chunks.push(arr.slice(chunkLength * i, chunkLength * (i + 1)));
    }
    return chunks;
};
