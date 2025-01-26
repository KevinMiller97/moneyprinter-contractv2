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

    struct Bond {
        uint256 interestRate; // Stored as percentage times 100 (e.g., 950 for 9.5%)
        uint256 mintTime;
        uint256 lastClaimTime;
        uint256 principal;
        bool principalClaimed;
    }

    mapping(uint256 => Bond) public bonds;

    error Unauthorized();
    error BondExpired();
    error ClaimIntervalNotReached();
    error PrincipalAlreadyClaimed();
    error PrincipalTooLow();

    event Minted(uint256 tokenId, address indexed newAddress);
    event InterestClaimed(uint256 tokenId, address indexed claimAddress);
    event PrincipalClaimed(uint256 tokenId, address indexed claimAddress);
    event ClaimInterestFailed(uint256 indexed tokenId, bytes reason);
    event MinimumPrincipalChanged(uint256 minimumPrincipal);

    function initialize(address initialOwner) public initializer {
        __ERC721_init("Federal Reserve Bond", "BOND");
        __ERC721Enumerable_init();
        __Ownable_init(initialOwner);
        __ReentrancyGuard_init();
        _transferOwnership(initialOwner);
    }

    function setMoneyTokenAddress(address _moneyTokenAddress) public onlyOwner {
        if (_moneyTokenAddress == address(0))
            revert("MoneyToken address cannot be zero");
        moneyToken = MoneyToken(_moneyTokenAddress);
    }

    function mintBond(uint256 principalAmount) public {
        require(
            moneyToken.transferFrom(msg.sender, address(this), principalAmount),
            "Transfer failed: insufficient allowance or balance"
        );

        uint256 tokenId = totalSupply() + 1;
        uint256 interestRate = _generateRandomInterestRate();
        _safeMint(msg.sender, tokenId);
        bonds[tokenId] = Bond(
            interestRate,
            block.timestamp,
            block.timestamp,
            principalAmount,
            false
        );
        emit Minted(tokenId, msg.sender);
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
        uint256 interestPerInterval = (bond.principal *
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

        require(
            moneyToken.balanceOf(address(this)) >= bond.principal,
            "Insufficient MoneyToken in contract"
        );
        require(
            moneyToken.transfer(msg.sender, bond.principal),
            "Transfer failed"
        );
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

        uint256 interestPerInterval = (bond.principal *
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

        uint256 interestRate = ((randomNumber % 16) + 10) * 10; // Range 1 to 2.5
        return interestRate; // Represents an interest rate with one decimal place (e.g., 23 = 2.3%)
    }

    // Storage gap for upgradeability
    uint256[50] private __gap;
}
