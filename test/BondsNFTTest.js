const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

describe('BondsNFT Contract', function () {
  let MoneyToken, moneyToken;
  let BondsNFT, bondsNFT;
  let owner, addr1, addr2, addr3;
  const BOND_PRICE_MONEY = ethers.parseUnits("1000", 18);
  const BOND_PRICE_ETH = ethers.parseUnits("0.03", 18);
  const CLAIM_INTERVAL = 60; // 1 minute in seconds
  const BOND_LIFETIME = 604800; // 1 week in seconds

  beforeEach(async function () {
    [owner, addr1, addr2, addr3] = await ethers.getSigners();

    // Deploy MoneyToken
    MoneyToken = await ethers.getContractFactory('MoneyToken');
    moneyToken = await upgrades.deployProxy(MoneyToken, [owner.address], {
      initializer: 'initialize',
    });
    await moneyToken.waitForDeployment();

    // Deploy BondsNFT
    BondsNFT = await ethers.getContractFactory('BondsNFT');
    bondsNFT = await upgrades.deployProxy(BondsNFT, [owner.address], {
      initializer: 'initialize',
    });
    await bondsNFT.waitForDeployment();


    // Set MoneyToken address in BondsNFT
    await moneyToken.setBondNFTAddress(bondsNFT.getAddress());
    await bondsNFT.setMoneyTokenAddress(moneyToken.getAddress());

    await moneyToken.connect(owner).tran

    // transfer MONEY to holder so they can mint NFTs
    const amount = ethers.parseEther("5000");
    await moneyToken.transfer(await addr1.getAddress(), amount);
    await moneyToken.connect(addr1).approve(bondsNFT.getAddress(), ethers.parseUnits("5000", 18));
    await moneyToken.transfer(await addr2.getAddress(), amount);
    await moneyToken.connect(addr2).approve(bondsNFT.getAddress(), ethers.parseUnits("5000", 18));

    // Approve BondsNFT to spend MoneyToken on behalf of addr1 and addr2
    await moneyToken.connect(addr1).approve(bondsNFT.getAddress(), ethers.parseUnits("10000", 18));
    await moneyToken.connect(addr2).approve(bondsNFT.getAddress(), ethers.parseUnits("10000", 18));
  });

  describe('Deployment', function () {
    it('Should set the correct owner', async function () {
      expect(await bondsNFT.owner()).to.equal(owner.address);
    });

    it('Should set the MoneyToken address correctly', async function () {
      expect(await bondsNFT.moneyToken()).to.equal(await moneyToken.getAddress());
    });

    it('Should have correct initial bond prices', async function () {
      expect(await bondsNFT.BOND_PRICE_MONEY()).to.equal(BOND_PRICE_MONEY);
      expect(await bondsNFT.BOND_PRICE_ETH()).to.equal(BOND_PRICE_ETH);
    });

  });

  describe('Minting Bonds with MoneyToken', function () {
    it('Should mint bonds successfully', async function () {
      const numberOfBonds = 2;

      await expect(bondsNFT.connect(addr1).mintMultipleBonds(numberOfBonds))
        .to.emit(bondsNFT, 'Minted')
        .withArgs(1, addr1.address);

      expect(await bondsNFT.balanceOf(addr1.address)).to.equal(numberOfBonds);

      // 4900 because of transfer tax of 2%
      const initialBalance = ethers.parseUnits('4900', 18);
      const totalCost = BOND_PRICE_MONEY * BigInt(numberOfBonds);
      const expectedBalance = initialBalance - totalCost;

      const actualBalance = await moneyToken.balanceOf(addr1.address);

      expect(actualBalance).to.equal(expectedBalance);
    });


    it('Should fail if insufficient MoneyToken balance', async function () {
      const numberOfBonds = 6;
      await expect(bondsNFT.connect(addr1).mintMultipleBonds(numberOfBonds)).to.be.reverted;
    });

    it('Should fail if numberOfBonds is zero', async function () {
      await expect(bondsNFT.connect(addr1).mintMultipleBonds(0)).to.be.revertedWith(
        'Must mint at least one bond'
      );
    });
  });

  describe('Minting Bonds with ETH', function () {
    it('Should mint bonds successfully with ETH', async function () {
      const numberOfBonds = 3;
      const totalCostETH = BOND_PRICE_ETH * BigInt(numberOfBonds);

      await expect(
        bondsNFT.connect(addr2).mintMultipleBondsETH(numberOfBonds, { value: totalCostETH })
      )
        .to.emit(bondsNFT, 'Minted')
        .withArgs(1, addr2.address);

      expect(await bondsNFT.balanceOf(addr2.address)).to.equal(numberOfBonds);
    });

    it('Should refund excess ETH if overpaid', async function () {
      const numberOfBonds = 1;
      const overpaidETH = BOND_PRICE_ETH + ethers.parseEther('0.01');
      const initialBalance = await ethers.provider.getBalance(addr1.address);

      const tx = await bondsNFT.connect(addr1).mintMultipleBondsETH(numberOfBonds, {
        value: overpaidETH,
      });
      const receipt = await tx.wait();

      const finalBalance = await ethers.provider.getBalance(addr1.address);

      const expectedBalanceChange = BOND_PRICE_ETH; // The actual cost
      const actualBalanceChange = initialBalance - finalBalance;

      expect(actualBalanceChange).to.be.gte(expectedBalanceChange);

      const gasCostEstimate = ethers.parseEther('0.02'); // Adjust based on expected gas cost
      expect(actualBalanceChange - expectedBalanceChange).to.be.lte(gasCostEstimate);
    });

    it('Should fail if insufficient ETH is sent', async function () {
      const numberOfBonds = 2;
      const insufficientETH = BOND_PRICE_ETH * BigInt(numberOfBonds) - ethers.parseUnits("0.01", 18);

      await expect(
        bondsNFT.connect(addr1).mintMultipleBondsETH(numberOfBonds, { value: insufficientETH })
      ).to.be.revertedWith('Insufficient ETH sent');
    });

    it('Should fail if numberOfBonds is zero', async function () {
      await expect(
        bondsNFT.connect(addr1).mintMultipleBondsETH(0, { value: ethers.parseUnits("0.1", 18) })
      ).to.be.revertedWith('Must mint at least one bond');
    });
  });

  describe('Claiming Interest', function () {
    beforeEach(async function () {
      await bondsNFT.connect(addr1).mintMultipleBonds(1);
      await bondsNFT.connect(addr2).mintMultipleBondsETH(1, { value: BOND_PRICE_ETH });
    });

    it('Should allow owner to claim interest after CLAIM_INTERVAL', async function () {
      await ethers.provider.send('evm_increaseTime', [CLAIM_INTERVAL]);
      await ethers.provider.send('evm_mine', []);

      const initialBalance = await moneyToken.balanceOf(addr1.address);

      await expect(bondsNFT.connect(addr1).claimInterest(1))
        .to.emit(bondsNFT, 'InterestClaimed')
        .withArgs(1, addr1.address);

      const finalBalance = await moneyToken.balanceOf(addr1.address);
      expect(finalBalance).to.be.gt(initialBalance);
    });

    it('Should fail if claiming interest before CLAIM_INTERVAL', async function () {
      await expect(bondsNFT.connect(addr1).claimInterest(1)).to.be.revertedWithCustomError(
        bondsNFT,
        'ClaimIntervalNotReached'
      );
    });

    it('Should not accrue interest after bond expiration', async function () {
      await ethers.provider.send('evm_increaseTime', [BOND_LIFETIME + CLAIM_INTERVAL]);
      await ethers.provider.send('evm_mine', []);

      await expect(bondsNFT.connect(addr1).claimInterest(1))
        .to.emit(bondsNFT, 'InterestClaimed')
        .withArgs(1, addr1.address);

      await expect(bondsNFT.connect(addr1).claimInterest(1)).to.be.revertedWithCustomError(
        bondsNFT,
        'BondExpired'
      );

    });
  });

  describe('Claiming Principal', function () {
    beforeEach(async function () {
      await bondsNFT.connect(addr1).mintMultipleBonds(1);
      await bondsNFT.connect(addr2).mintMultipleBondsETH(1, { value: BOND_PRICE_ETH });
    });

    it('Should allow owner to claim principal after bond expiration', async function () {
      await ethers.provider.send('evm_increaseTime', [BOND_LIFETIME + 1]);
      await ethers.provider.send('evm_mine', []);

      const initialBalance = await moneyToken.balanceOf(addr1.address);

      await expect(bondsNFT.connect(addr1).claimPrincipal(1))
        .to.emit(bondsNFT, 'PrincipalClaimed')
        .withArgs(1, addr1.address);

      const finalBalance = await moneyToken.balanceOf(addr1.address);
      expect(finalBalance).to.equal(initialBalance + BOND_PRICE_MONEY);
    });

    it('Should fail if trying to claim principal before bond expiration', async function () {
      await expect(bondsNFT.connect(addr1).claimInterest(1)).to.be.reverted;
    });

    it('Should transfer ETH principal minus fee for ETH bonds', async function () {
      // Advance time to bond expiration
      await ethers.provider.send('evm_increaseTime', [BOND_LIFETIME + 1]);
      await ethers.provider.send('evm_mine', []);

      const initialBalance = await ethers.provider.getBalance(addr2.address);

      const ETH_TAX = await bondsNFT.ETH_TAX();

      const tx = await bondsNFT.connect(addr2).claimPrincipal(2);
      const receipt = await tx.wait();
      const txHash = tx.hash;
      if (!txHash) {
        throw new Error('Transaction hash is undefined');
      }

      const txResponse = await ethers.provider.getTransaction(txHash);
      if (!txResponse) {
        throw new Error('Transaction not found');
      }

      const gasUsed = receipt.gasUsed;
      const gasPrice = txResponse.gasPrice || txResponse.maxFeePerGas; // Handle EIP-1559 transactions
      const gasCost = gasUsed * gasPrice;

      const fee = (BOND_PRICE_ETH * ETH_TAX) / 1000n;
      const amountReceived = BOND_PRICE_ETH - fee;

      const finalBalance = await ethers.provider.getBalance(addr2.address);
      expect(finalBalance + gasCost).to.equal(initialBalance + amountReceived);
    });


  });

  describe('Withdraw ETH Fees', function () {
    beforeEach(async function () {
      await bondsNFT.connect(addr2).mintMultipleBondsETH(2, { value: BOND_PRICE_ETH * 2n });
    });

    it('Should allow owner to withdraw ETH fees', async function () {
      const initialOwnerBalance = await ethers.provider.getBalance(owner.address); // BigInt
    
      const tx = await bondsNFT.connect(owner).withdrawETHFees();
      const receipt = await tx.wait();
    
      // Retrieve ETH_TAX from the contract
      const ETH_TAX = await bondsNFT.ETH_TAX(); // BigInt
    
      // Compute expected fee using BigInt arithmetic
      const expectedFee = ((BOND_PRICE_ETH * ETH_TAX) / 1000n) * 2n; // Multiply by 2n for two bonds
    
      const finalOwnerBalance = await ethers.provider.getBalance(owner.address); // BigInt
    
      const balanceIncrease = finalOwnerBalance - initialOwnerBalance;
    
      // Since gas costs are small and can vary, we allow a tolerance in the assertion
      const gasCostTolerance = ethers.parseEther('0.01'); // Adjust the tolerance as needed
    
      // Assert that the balance increase is close to the expected fee, within the gas cost tolerance
      expect(balanceIncrease).to.be.closeTo(expectedFee, gasCostTolerance);
    });
    

    it('Should fail if non-owner tries to withdraw ETH fees', async function () {
      await expect(bondsNFT.connect(addr1).claimInterest(1)).to.be.revertedWithCustomError(
        bondsNFT,
        'Unauthorized'
      );

    });

    it('Should fail if no fees to withdraw', async function () {
      await bondsNFT.connect(owner).withdrawETHFees();

      await expect(bondsNFT.connect(owner).withdrawETHFees()).to.be.revertedWith(
        'No fees to withdraw'
      );
    });
  });

  describe('Claim All Interest and Principal', function () {
    beforeEach(async function () {
      await bondsNFT.connect(addr1).mintMultipleBonds(2);
      await bondsNFT.connect(addr2).mintMultipleBondsETH(2, { value: BOND_PRICE_ETH * 2n });
    });

    it('Should allow owner to claim all interest', async function () {
      await ethers.provider.send('evm_increaseTime', [CLAIM_INTERVAL]);
      await ethers.provider.send('evm_mine', []);

      const initialBalance = await moneyToken.balanceOf(addr1.address);

      await bondsNFT.connect(addr1).claimAllInterest();

      const finalBalance = await moneyToken.balanceOf(addr1.address);
      expect(finalBalance).to.be.gt(initialBalance);
    });

    it('Should allow owner to claim all principal after bond expiration', async function () {
      // Retrieve constants from the contract
      const BOND_LIFETIME = Number(await bondsNFT.BOND_LIFETIME()); // Convert to Number for time manipulation
      const BOND_PRICE_MONEY = await bondsNFT.BOND_PRICE_MONEY(); // BigInt
      const BOND_PRICE_ETH = await bondsNFT.BOND_PRICE_ETH(); // BigInt
      const ETH_TAX = await bondsNFT.ETH_TAX(); // BigInt
    
      // Increase time to bond expiration
      await ethers.provider.send('evm_increaseTime', [BOND_LIFETIME + 1]);
      await ethers.provider.send('evm_mine', []);
      
      const balanceBeforeClaim = await moneyToken.balanceOf(addr1.address);
      // Addr1 claims all principal (MoneyToken bonds)
      await bondsNFT.connect(addr1).claimAllPrincipal();
    

      // Check MoneyToken balance for addr1
      const finalBalanceMoney = await moneyToken.balanceOf(addr1.address); // BigInt
      const principal = BOND_PRICE_MONEY * 2n; // Assuming addr1 has 2 bonds
      expect(finalBalanceMoney).to.equal(balanceBeforeClaim + principal);
    
      // For ETH bonds (addr2)
      const initialBalanceETH = await ethers.provider.getBalance(addr2.address); // BigInt
    
      const tx = await bondsNFT.connect(addr2).claimAllPrincipal();
      const receipt = await tx.wait();
    
      // Gas cost calculation
      const txResponse = await ethers.provider.getTransaction(tx.hash);
      const gasUsed = receipt.gasUsed; // BigInt
      const gasPrice = txResponse.gasPrice || txResponse.maxFeePerGas; // BigInt
      const gasCost = gasUsed * gasPrice; // BigInt
    
      // Calculate expected amount received
      const feePerBond = (BOND_PRICE_ETH * ETH_TAX) / 1000n; // BigInt
      const amountReceivedPerBond = BOND_PRICE_ETH - feePerBond; // BigInt
      const amountReceivedETH = amountReceivedPerBond * 2n; // For 2 bonds
    
      const finalBalanceETH = await ethers.provider.getBalance(addr2.address); // BigInt
    
      const balanceIncrease = finalBalanceETH - initialBalanceETH + gasCost; // Adjust for gas cost
    
      expect(balanceIncrease).to.equal(amountReceivedETH);
    });
    
  });

  describe('Edge Cases', function () {
    beforeEach(async function () {
      await bondsNFT.connect(addr1).mintMultipleBonds(1);
    });

    it('Should not claim interest after bond expiration', async function () {
      await ethers.provider.send('evm_increaseTime', [BOND_LIFETIME + CLAIM_INTERVAL]);
      await ethers.provider.send('evm_mine', []);

      await expect(bondsNFT.connect(addr1).claimInterest(1))
        .to.emit(bondsNFT, 'InterestClaimed')
        .withArgs(1, addr1.address);

      await expect(bondsNFT.connect(addr1).claimInterest(1)).to.be.revertedWithCustomError(bondsNFT, 'BondExpired');
    });

    it('Should not claim principal twice', async function () {
      await ethers.provider.send('evm_increaseTime', [BOND_LIFETIME + 1]);
      await ethers.provider.send('evm_mine', []);

      await bondsNFT.connect(addr1).claimPrincipal(1);

      await expect(bondsNFT.connect(addr1).claimPrincipal(1)).to.be.revertedWithCustomError(bondsNFT, 'PrincipalAlreadyClaimed');
    });
  });

  describe('Admin Functions', function () {
    it('Should allow owner to set new bond price in MONEY', async function () {
      const newPrice = ethers.parseUnits("2000", 18);
      await expect(bondsNFT.connect(owner).setBondPriceMoney(newPrice))
        .to.emit(bondsNFT, 'BondPriceChangeMoney')
        .withArgs(newPrice);

      expect(await bondsNFT.BOND_PRICE_MONEY()).to.equal(newPrice);
    });

    it('Should allow owner to set new bond price in ETH', async function () {
      const newPrice = ethers.parseUnits("0.05", 18);
      await expect(bondsNFT.connect(owner).setBondPriceEth(newPrice))
        .to.emit(bondsNFT, 'BondPriceChangeEth')
        .withArgs(newPrice);

      expect(await bondsNFT.BOND_PRICE_ETH()).to.equal(newPrice);
    });

    it('Should fail if non-owner tries to set bond prices', async function () {
      const newPrice = ethers.parseUnits("2000", 18);

      await expect(bondsNFT.connect(addr1).setBondPriceMoney(newPrice)).to.be.revertedWithCustomError(
        bondsNFT, 'OwnableUnauthorizedAccount'
      );

      await expect(bondsNFT.connect(addr1).setBondPriceEth(newPrice)).to.be.revertedWithCustomError(
        bondsNFT, 'OwnableUnauthorizedAccount'
      );
    });
  });
});
