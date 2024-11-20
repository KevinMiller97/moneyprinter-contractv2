// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Import upgradeable contracts
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./MoneyToken.sol";

contract BondsNFT is
    ERC721EnumerableUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    MoneyToken public moneyToken;

    uint256 public constant CLAIM_INTERVAL = 1 minutes;
    uint256 public constant BOND_LIFETIME = 1 weeks;
    uint256 public constant ETH_TAX = 50; // later divided by 1000

    uint256 public BOND_PRICE_MONEY;
    uint256 public BOND_PRICE_ETH;

    uint256 private ethBondFeesCollected;

    struct Bond {
        uint256 interestRate; // Stored as percentage times 100 (e.g., 950 for 9.5%)
        uint256 mintTime;
        uint256 lastClaimTime;
        uint256 principal;
        uint256 principalMoneyEquivalent;
        bool principalClaimed;
        bool principalInEth;
    }

    mapping(uint256 => Bond) public bonds;

    error Unauthorized();
    error BondExpired();
    error ClaimIntervalNotReached();
    error PrincipalAlreadyClaimed();
    event Minted(uint256 tokenId, address indexed newAddress);
    event InterestClaimed(uint256 tokenId, address indexed claimAddress);
    event PrincipalClaimed(uint256 tokenId, address indexed claimAddress);
    event BondPriceChangeMoney(uint256 amount);
    event BondPriceChangeEth(uint256 amount);
    event ClaimInterestFailed(uint256 indexed tokenId, bytes reason);

    function initialize(address initialOwner) public initializer {
        __ERC721_init("Federal Reserve Bond", "BOND");
        __ERC721Enumerable_init();
        __Ownable_init(initialOwner);
        __ReentrancyGuard_init();
        _transferOwnership(initialOwner);

        BOND_PRICE_MONEY = 1000 * 10 ** 18;
        BOND_PRICE_ETH = 0.03 ether;
    }

    function setMoneyTokenAddress(address _moneyTokenAddress) public onlyOwner {
        if (_moneyTokenAddress == address(0))
            revert("MoneyToken address cannot be zero");
        moneyToken = MoneyToken(_moneyTokenAddress);
    }

    // used to potentially adjust for inflation down the line. Will not affect Holders of existing BondNFT's
    function setBondPriceMoney(uint256 _bondPriceMoney) public onlyOwner {
        BOND_PRICE_MONEY = _bondPriceMoney;
        emit BondPriceChangeMoney(BOND_PRICE_MONEY);
    }

    // used to adjust for market cap of $MONEY. Will not affect Holders of existing BondNFT's
    function setBondPriceEth(uint256 _bondPriceEth) public onlyOwner {
        BOND_PRICE_ETH = _bondPriceEth;
        emit BondPriceChangeEth(BOND_PRICE_ETH);
    }

    function mintMultipleBonds(uint256 numberOfBonds) public {
        if (numberOfBonds == 0) revert("Must mint at least one bond");
        uint256 totalCost = BOND_PRICE_MONEY * numberOfBonds;
        require(
            moneyToken.transferFrom(msg.sender, address(this), totalCost),
            "Transfer failed"
        );

        for (uint256 i = 0; i < numberOfBonds; i++) {
            uint256 tokenId = totalSupply() + 1;
            uint256 interestRate = _generateRandomInterestRate();
            _safeMint(msg.sender, tokenId);
            bonds[tokenId] = Bond(
                interestRate,
                block.timestamp,
                block.timestamp,
                BOND_PRICE_MONEY,
                BOND_PRICE_MONEY,
                false,
                false
            );
            emit Minted(tokenId, msg.sender);
        }
    }

    function mintMultipleBondsETH(uint256 numberOfBonds) public payable {
        if (numberOfBonds == 0) revert("Must mint at least one bond");

        // Calculate the total ETH cost including fees
        uint256 totalCostETH = BOND_PRICE_ETH * numberOfBonds;
        uint256 totalFeeETH = ((BOND_PRICE_ETH * ETH_TAX) / 1000) *
            numberOfBonds;
        uint256 totalETHRequired = totalCostETH + totalFeeETH;

        // Check if sufficient ETH was sent
        if (msg.value < totalETHRequired) revert("Insufficient ETH sent");

        // Collect the total fee into the contract's balance
        ethBondFeesCollected += totalFeeETH;

        for (uint256 i = 0; i < numberOfBonds; i++) {
            uint256 tokenId = totalSupply() + 1;
            uint256 interestRate = _generateRandomInterestRate();
            _safeMint(msg.sender, tokenId);
            bonds[tokenId] = Bond(
                interestRate,
                block.timestamp,
                block.timestamp,
                BOND_PRICE_ETH,
                BOND_PRICE_MONEY,
                false,
                true
            );
            emit Minted(tokenId, msg.sender);
        }

        // Refund any excess ETH sent
        if (msg.value > totalETHRequired) {
            payable(msg.sender).transfer(msg.value - totalETHRequired);
        }
    }

    function claimInterest(uint256 tokenId) public nonReentrant {
        if (ownerOf(tokenId) != msg.sender) revert Unauthorized();

        Bond storage bond = bonds[tokenId];

        uint256 lastClaimTime = bond.lastClaimTime;
        uint256 currentTime = block.timestamp;
        uint256 bondExpiryTime = bond.mintTime + BOND_LIFETIME;

        // Set the end time for interest calculation. If the bond is expired,
        // we allow claiming interest only up to the expiration time.
        uint256 endTime = currentTime < bondExpiryTime
            ? currentTime
            : bondExpiryTime;
        uint256 timeSinceLastClaim = endTime - lastClaimTime;
        uint256 claimableIntervals = timeSinceLastClaim / CLAIM_INTERVAL;

        // Ensure there's a claimable interval
        if (claimableIntervals == 0 && !bond.principalClaimed)
            revert ClaimIntervalNotReached();

        // Calculate the interest accrued per interval and total interest to be claimed
        uint256 interestPerInterval = (bond.principalMoneyEquivalent *
            bond.interestRate *
            CLAIM_INTERVAL) / (10000 * 1 days);
        uint256 totalInterest = interestPerInterval * claimableIntervals;

        // Update the bond's last claim time
        bond.lastClaimTime =
            lastClaimTime +
            (claimableIntervals * CLAIM_INTERVAL);

        // Mint the interest tokens to the bond owner
        moneyToken.mint(msg.sender, totalInterest);
        emit InterestClaimed(tokenId, msg.sender);
    }

    function claimAllInterest() public {
        uint256 ownerTokenCount = balanceOf(msg.sender);
        for (uint256 i = 0; i < ownerTokenCount; i++) {
            uint256 tokenId = tokenOfOwnerByIndex(msg.sender, i);
            claimInterest(tokenId); // Call claimInterest for each eligible bond
        }
    }

    function claimPrincipal(uint256 tokenId) public nonReentrant {
        if (ownerOf(tokenId) != msg.sender) revert Unauthorized();
        Bond storage bond = bonds[tokenId];

        if (block.timestamp <= bond.mintTime + BOND_LIFETIME)
            revert("Bond lifetime has not expired");
        if (bond.principalClaimed) revert PrincipalAlreadyClaimed();

        bond.principalClaimed = true; // Update state before external calls

        if (bond.principalInEth) {
            uint256 amount = bond.principal -
                ((bond.principal * ETH_TAX) / 1000);
            require(
                address(this).balance >= amount,
                "Insufficient ETH in contract"
            );
            payable(msg.sender).transfer(amount);
        } else {
            require(
                moneyToken.balanceOf(address(this)) >= bond.principal,
                "Insufficient MoneyToken in contract"
            );
            require(
                moneyToken.transfer(msg.sender, bond.principal),
                "Transfer failed"
            );
        }
        emit PrincipalClaimed(tokenId, msg.sender);
    }

    function claimAllPrincipal() public {
        uint256 ownerTokenCount = balanceOf(msg.sender);
        require(ownerTokenCount > 0, "No bonds owned");
        for (uint256 i = 0; i < ownerTokenCount; i++) {
            uint256 tokenId = tokenOfOwnerByIndex(msg.sender, i);
            if (block.timestamp <= bonds[tokenId].mintTime + BOND_LIFETIME) {
                continue;
            }
            if (bonds[tokenId].principalClaimed) {
                continue;
            }
            try this.claimInterest(tokenId) {
                // claim remaining interest before claiming principal
            } catch {
                // claiming interest will revert if no interest can be claimed
                // safe to ignore and skip interest claiming for this bond
            }
            claimPrincipal(tokenId);
        }
    }

    function viewPendingInterest(
        uint256 tokenId
    ) public view returns (uint256) {
        Bond memory bond = bonds[tokenId];
        uint256 lastClaimTime = bond.lastClaimTime;
        uint256 currentTime = block.timestamp;
        uint256 bondExpiryTime = bond.mintTime + BOND_LIFETIME;

        if (lastClaimTime >= bondExpiryTime) return 0;

        uint256 endTime = currentTime < bondExpiryTime
            ? currentTime
            : bondExpiryTime;
        uint256 timeSinceLastClaim = endTime - lastClaimTime;
        uint256 claimableIntervals = timeSinceLastClaim / CLAIM_INTERVAL;

        uint256 interestPerInterval = (bond.principalMoneyEquivalent *
            bond.interestRate *
            CLAIM_INTERVAL) / (10000 * 1 days);
        uint256 totalInterest = interestPerInterval * claimableIntervals;

        return totalInterest;
    }

    function _generateRandomInterestRate() private view returns (uint256) {
        uint256 randomNumber = uint256(
            keccak256(
                abi.encodePacked(
                    blockhash(block.number - 1),
                    totalSupply(),
                    block.timestamp,
                    msg.sender
                )
            )
        );

        uint256 interestRate = ((randomNumber % 31) + 10) * 10; // Range 10 to 40
        return interestRate; // Represents an interest rate with one decimal place (e.g., 23 = 2.3%)
    }

    function withdrawETHFees() public onlyOwner {
        uint256 withdrawalAmount = ethBondFeesCollected;
        uint256 contractBalance = address(this).balance;

        require(
            contractBalance >= withdrawalAmount,
            "Insufficient balance in contract"
        );
        require(withdrawalAmount > 0, "No fees to withdraw");

        ethBondFeesCollected = 0; // Reset before transfer to prevent reentrancy

        (bool success, ) = owner().call{value: withdrawalAmount}("");
        require(success, "Failed to send ether");
    }

    // Storage gap for upgradeability
    uint256[50] private __gap;
}
