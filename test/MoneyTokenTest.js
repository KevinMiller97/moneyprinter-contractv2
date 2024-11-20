const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

describe('MoneyToken', function () {
    let MoneyToken, moneyToken;
    let owner, addr1, addr2, bondsNFTContract, airdropContract;

    beforeEach(async function () {
        [owner, addr1, addr2, bondsNFTContract, airdropContract] = await ethers.getSigners();

        // Deploy MoneyToken
        MoneyToken = await ethers.getContractFactory('MoneyToken');
        moneyToken = await upgrades.deployProxy(MoneyToken, [owner.address], {
            initializer: 'initialize',
        });
        await moneyToken.waitForDeployment();

        // Set the bondsNFTContract and airdropContract addresses
        await moneyToken.setBondNFTAddress(bondsNFTContract.address);
        await moneyToken.setAirdropAddress(airdropContract.address);
    });

    it('Should have correct name and symbol', async function () {
        expect(await moneyToken.name()).to.equal('Legal Tender');
        expect(await moneyToken.symbol()).to.equal('MONEY');
    });

    describe("Deployment", function () {
        it("should set the right owner", async function () {
            expect(await moneyToken.owner()).to.equal(await owner.getAddress());
        });

        it("should assign the initial supply of tokens to the owner", async function () {
            const ownerBalance = await moneyToken.balanceOf(await owner.getAddress());
            expect(ownerBalance).to.equal(ethers.parseUnits("1000000", 18));
        });
    });

    it('Should assign the initial supply to the owner', async function () {
        const ownerBalance = await moneyToken.balanceOf(owner.address);
        expect(await moneyToken.totalSupply()).to.equal(ownerBalance);
    });

    it('Should transfer tokens between accounts with tax applied', async function () {
        // Transfer 100 tokens from owner to addr1
        await moneyToken.transfer(addr1.address, ethers.parseUnits("100", 18));

        // Check balances
        const addr1Balance = await moneyToken.balanceOf(addr1.address);
        const taxAccountBalance = await moneyToken.balanceOf(owner.address); // owner is taxAccount

        expect(addr1Balance).to.equal(ethers.parseUnits("98", 18)); // 2% tax applied
        expect(taxAccountBalance).to.be.above(ethers.parseUnits("999900", 18)); // Tax accumulated
    });

    it('Should allow bondsNFTContract to mint tokens', async function () {
        // Connect as bondsNFTContract
        const moneyTokenAsBond = moneyToken.connect(bondsNFTContract);

        // Mint tokens to addr1
        await moneyTokenAsBond.mint(addr1.address, ethers.parseUnits("100", 18));

        const addr1Balance = await moneyToken.balanceOf(addr1.address);
        expect(addr1Balance).to.equal(ethers.parseUnits("100", 18));
    });

    it('Should prevent others from minting tokens', async function () {
        await expect(
            moneyToken.connect(addr1).mint(addr1.address, ethers.parseUnits("100", 18))
        ).to.be.revertedWithCustomError(moneyToken, 'UnauthorizedNotBond');
    });

    it('Should allow transfers without tax to/from bondsNFTContract and airdropContract', async function () {
        // Transfer tokens to bondsNFTContract
        await moneyToken.transfer(bondsNFTContract.address, ethers.parseUnits("100", 18));
        const bondBalance = await moneyToken.balanceOf(bondsNFTContract.address);
        expect(bondBalance).to.equal(ethers.parseUnits("100", 18));

        // Transfer tokens from bondsNFTContract to addr1
        const moneyTokenAsBond = moneyToken.connect(bondsNFTContract);
        await moneyTokenAsBond.transfer(addr1.address, ethers.parseUnits("50", 18));
        const addr1Balance = await moneyToken.balanceOf(addr1.address);
        expect(addr1Balance).to.equal(ethers.parseUnits("50", 18));
    });

    it('Should allow owner to set new tax account', async function () {
        await moneyToken.setTaxAccount(addr2.address);
        await moneyToken.transfer(addr1.address, ethers.parseUnits("100", 18));

        const taxAccountBalance = await moneyToken.balanceOf(addr2.address);
        expect(taxAccountBalance).to.equal(ethers.parseUnits("2", 18));
    });

    describe("mint", function () {
        it("should not allow the owner to mint new tokens", async function () {
            // Set the bondsNFTContract address first
            await moneyToken.setBondNFTAddress(await addr1.getAddress());

            // Owner minting
            await expect(moneyToken.connect(owner).mint(owner.getAddress(), 100))
                .to.be.revertedWithCustomError(moneyToken, "UnauthorizedNotBond");
        });
        it("should allow the bondsNFTContract to mint new tokens", async function () {
            // BondsNFTContract minting
            await moneyToken.setBondNFTAddress(await addr1.getAddress());

            await expect(moneyToken.connect(addr1).mint(owner.getAddress(), 100))
                .to.changeTokenBalance(moneyToken, owner, 100);
        });
        it("should not allow unauthorized addresses to mint tokens", async function () {
            await moneyToken.setBondNFTAddress(await addr1.getAddress());

            await expect(moneyToken.connect(addr2).mint(addr2.getAddress(), 100))
                .to.be.revertedWithCustomError(moneyToken, "UnauthorizedNotBond");
        });
    });

});
