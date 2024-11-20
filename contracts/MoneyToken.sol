// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/*
||====================================================================||
||//$\\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\//$\\||
||(100)==================| FEDERAL RESERVE NOTE |================(100)||
||\\$//        ~         '------========--------'                \\$//||
||<< /        /$\              // ____ \\                         \ >>||
||>>|  12    //L\\            // ///..) \\         L38036133B   12 |<<||
||<<|        \\ //           || <||  >\  ||                        |>>||
||>>|         \$/            ||  $$ --/  ||        One Hundred     |<<||
||<<|      L38036133B        *\\  |\_/  //* series                 |>>||
||>>|  12                     *\\/___\_//*   1989                  |<<||
||<<\      Treasurer     ______/Franklin\________     Secretary 12 />>||
||//$\                 ~|UNITED STATES OF AMERICA|~               /$\\||
||(100)===================  ONE HUNDRED DOLLARS =================(100)||
||\\$//\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\\$//||
||====================================================================||
*/


contract MoneyToken is
    ERC20Upgradeable,
    ERC20BurnableUpgradeable,
    OwnableUpgradeable
{
    address private bondsNFTContract;
    address private airdropContract;
    address private taxAccount;
    uint256 public constant INITIAL_SUPPLY = 1000000 * 10 ** 18;
    uint256 public constant TAX_PERCENTAGE = 2;

    error UnauthorizedNotBond();
    event BondNFTAddressSet(address indexed newAddress);
    event AirdropAddressSet(address indexed newAddress);
    event TaxAccountChanged(address indexed newTaxAccount);
    event TaxApplied(
        address indexed sender,
        address indexed recipient,
        uint256 taxAmount
    );

    function initialize(address initialOwner) public initializer {
        __ERC20_init("Legal Tender", "MONEY");
        __ERC20Burnable_init();
        __Ownable_init(initialOwner);
        _transferOwnership(initialOwner);
        _mint(initialOwner, INITIAL_SUPPLY);
        taxAccount = initialOwner;
    }

    function setBondNFTAddress(address _bondsNFTContract) public onlyOwner {
        bondsNFTContract = _bondsNFTContract;
        emit BondNFTAddressSet(_bondsNFTContract);
    }

    function setAirdropAddress(address _airdropAddress) public onlyOwner {
        airdropContract = _airdropAddress;
        emit AirdropAddressSet(_airdropAddress);
    }

    function setTaxAccount(address newTaxAccount) public onlyOwner {
        taxAccount = newTaxAccount;
        emit TaxAccountChanged(newTaxAccount);
    }

    function transfer(
        address recipient,
        uint256 amount
    ) public override returns (bool) {
        if (
            msg.sender == bondsNFTContract ||
            recipient == bondsNFTContract ||
            msg.sender == airdropContract ||
            recipient == airdropContract
        ) {
            return super.transfer(recipient, amount);
        }
        uint256 taxAmount = (amount * TAX_PERCENTAGE) / 100;
        uint256 sendAmount = amount - taxAmount;
        _transfer(_msgSender(), taxAccount, taxAmount);
        emit TaxApplied(_msgSender(), recipient, taxAmount);
        _transfer(_msgSender(), recipient, sendAmount);
        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override returns (bool) {
        if (
            sender == bondsNFTContract ||
            recipient == bondsNFTContract ||
            sender == airdropContract ||
            recipient == airdropContract
        ) {
            return super.transferFrom(sender, recipient, amount);
        }
        uint256 taxAmount = (amount * TAX_PERCENTAGE) / 100;
        uint256 sendAmount = amount - taxAmount;
        _spendAllowance(sender, _msgSender(), amount);
        _transfer(sender, taxAccount, taxAmount);
        emit TaxApplied(sender, recipient, taxAmount);
        _transfer(sender, recipient, sendAmount);
        return true;
    }

    // Modifier to restrict minting to only the BOND NFT contract
    modifier onlyBond() {
        if (msg.sender != bondsNFTContract) {
            revert UnauthorizedNotBond();
        }
        _;
    }

    function mint(address recipient, uint256 amount) public onlyBond {
        _mint(recipient, amount);
    }

    uint256[50] private __gap;
}
