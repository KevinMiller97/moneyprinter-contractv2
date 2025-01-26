const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

describe('BondsNFT Contract', function () {
  let MoneyToken, moneyToken;
  let BondsNFT, bondsNFT;
  let owner, addr1, addr2;
  const CLAIM_INTERVAL = 60; // 1 minute in seconds
  const BOND_LIFETIME = 604800; // 1 week in seconds

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

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

    // Distribute $MONEY to addr1 and addr2
    const amount = ethers.parseUnits("5000", 18);
    await moneyToken.transfer(addr1.address, amount);
    await moneyToken.transfer(addr2.address, amount);

    // Approve BondsNFT to spend $MONEY for addr1 and addr2
    await moneyToken.connect(addr1).approve(bondsNFT.getAddress(), amount);
    await moneyToken.connect(addr2).approve(bondsNFT.getAddress(), amount);
  });

  describe('Deployment', function () {
    it('Should set the correct owner', async function () {
      expect(await bondsNFT.owner()).to.equal(owner.address);
    });

    it('Should set the MoneyToken address correctly', async function () {
      expect(await bondsNFT.moneyToken()).to.equal(await moneyToken.getAddress());
    });
  });

  describe('Minting Bonds', function () {
    it('Should mint bonds successfully with custom principal', async function () {
      const principal = ethers.parseUnits("1000", 18);

      await expect(bondsNFT.connect(addr1).mintBond(principal))
        .to.emit(bondsNFT, 'Minted')
        .withArgs(1, addr1.address);

      expect(await bondsNFT.balanceOf(addr1.address)).to.equal(1);

      const remainingBalance = await moneyToken.balanceOf(addr1.address);
      expect(remainingBalance).to.equal(ethers.parseUnits("3900", 18));
    });

    it('Should fail if user has insufficient $MONEY', async function () {
      const principal = ethers.parseUnits("6000", 18); // Exceeds balance
      await moneyToken.connect(addr1).approve(bondsNFT.getAddress(), principal);

      await expect(bondsNFT.connect(addr1).mintBond(principal)).to.be.reverted;
    });
  });

  describe('Claiming Interest', function () {
    beforeEach(async function () {
      const principal = ethers.parseUnits("1000", 18);
      await bondsNFT.connect(addr1).mintBond(principal);
    });

    it('Should allow user to claim interest after CLAIM_INTERVAL', async function () {
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
  });

  describe('Claiming Principal', function () {
    beforeEach(async function () {
      const principal = ethers.parseUnits("1000", 18);
      await bondsNFT.connect(addr1).mintBond(principal);
    });

    it('Should allow user to claim principal after bond expiration', async function () {
      await ethers.provider.send('evm_increaseTime', [BOND_LIFETIME + 1]);
      await ethers.provider.send('evm_mine', []);

      const initialBalance = await moneyToken.balanceOf(addr1.address);

      await expect(bondsNFT.connect(addr1).claimPrincipal(1))
        .to.emit(bondsNFT, 'PrincipalClaimed')
        .withArgs(1, addr1.address);

      const finalBalance = await moneyToken.balanceOf(addr1.address);
      expect(finalBalance).to.equal(initialBalance + ethers.parseUnits("1000", 18));
    });

    it('Should fail if claiming principal before bond expiration', async function () {
      await expect(bondsNFT.connect(addr1).claimPrincipal(1)).to.be.revertedWith(
        'Bond lifetime has not expired'
      );
    });

    it('Should fail if principal is already claimed', async function () {
      await ethers.provider.send('evm_increaseTime', [BOND_LIFETIME + 1]);
      await ethers.provider.send('evm_mine', []);

      await bondsNFT.connect(addr1).claimPrincipal(1);

      await expect(bondsNFT.connect(addr1).claimPrincipal(1)).to.be.revertedWithCustomError(
        bondsNFT,
        'PrincipalAlreadyClaimed'
      );
    });
  });

  describe('Claim All Functions', function () {
    beforeEach(async function () {
      const principal = ethers.parseUnits("1000", 18);
      await bondsNFT.connect(addr1).mintBond(principal);
      await bondsNFT.connect(addr1).mintBond(principal);
    });

    it('Should allow user to claim all interest', async function () {
      await ethers.provider.send('evm_increaseTime', [CLAIM_INTERVAL]);
      await ethers.provider.send('evm_mine', []);

      const initialBalance = await moneyToken.balanceOf(addr1.address);

      await bondsNFT.connect(addr1).claimAllInterest();

      const finalBalance = await moneyToken.balanceOf(addr1.address);
      expect(finalBalance).to.be.gt(initialBalance);
    });

    it('Should allow user to claim all principal after bond expiration', async function () {
      await ethers.provider.send('evm_increaseTime', [BOND_LIFETIME + 1]);
      await ethers.provider.send('evm_mine', []);

      const initialBalance = await moneyToken.balanceOf(addr1.address);

      await bondsNFT.connect(addr1).claimAllPrincipal();

      const finalBalance = await moneyToken.balanceOf(addr1.address);
      expect(finalBalance).to.equal(initialBalance + ethers.parseUnits("2000", 18));
    });
  });
});
