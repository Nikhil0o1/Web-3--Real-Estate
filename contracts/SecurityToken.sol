// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/Address.sol";

interface IRentalYieldDistributor {
    function onTokenTransfer(address from, address to, uint256 amount) external;
}

contract SecurityToken is ERC20, Ownable, ReentrancyGuard, Pausable {
    mapping(address => bool) public whitelist;
    address public distributor;
    uint256 public immutable propertyId;
    uint256 public immutable salePricePerTokenWei;

    event InvestmentCompleted(address indexed investor, uint256 indexed propertyId, uint256 tokenAmount, uint256 ethSpent);
    event WhitelistUpdated(address indexed account, bool approved);
    event DistributorUpdated(address indexed distributor);
    event TokensMinted(address indexed to, uint256 amount);

    constructor(uint256 propertyId_, string memory name_, string memory symbol_, uint256 salePricePerTokenWei_)
        ERC20(name_, symbol_)
    {
        propertyId = propertyId_;
        salePricePerTokenWei = salePricePerTokenWei_;
    }

    function setWhitelisted(address account, bool approved) external onlyOwner {
        require(account != address(0), "Invalid account address");
        whitelist[account] = approved;
        emit WhitelistUpdated(account, approved);
    }

    function setDistributor(address distributor_) external onlyOwner {
        require(distributor_ != address(0), "Invalid distributor address");
        distributor = distributor_;
        emit DistributorUpdated(distributor_);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient address");
        require(amount > 0, "Mint amount must be positive");
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    // Emergency functions
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function invest(uint256 propertyId_, uint256 tokenAmount) external payable nonReentrant whenNotPaused {
        require(propertyId_ == propertyId, "Invalid property ID");
        require(tokenAmount > 0, "Token amount must be positive");
        require(tokenAmount <= 1000000 * (10 ** decimals()), "Token amount too large"); // Reasonable upper limit
        
        uint256 requiredWei = salePricePerTokenWei * tokenAmount;
        require(msg.value >= requiredWei, "Insufficient ETH sent");
        require(msg.value <= requiredWei * 2, "Excessive ETH sent"); // Prevent dust attacks
        
        uint256 tokenAmountBase = tokenAmount * (10 ** uint256(decimals()));
        require(balanceOf(address(this)) >= tokenAmountBase, "Insufficient tokens available for sale");
        
        // Check-effects-interactions pattern
        uint256 refundAmount = msg.value - requiredWei;
        
        // Effects
        _transfer(address(this), msg.sender, tokenAmountBase);
        
        // Interactions
        address payable treasury = payable(owner());
        Address.sendValue(treasury, requiredWei);
        
        if (refundAmount > 0) {
            Address.sendValue(payable(msg.sender), refundAmount);
        }
        
        emit InvestmentCompleted(msg.sender, propertyId_, tokenAmount, requiredWei);
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
        super._beforeTokenTransfer(from, to, amount);
        if (from == address(0) || to == address(0)) {
            return;
        }
        if (from == address(this) || to == address(this)) {
            return;
        }
        require(whitelist[from] && whitelist[to], "KYC required");
    }

    function _afterTokenTransfer(address from, address to, uint256 amount) internal override {
        super._afterTokenTransfer(from, to, amount);
        if (distributor != address(0)) {
            IRentalYieldDistributor(distributor).onTokenTransfer(from, to, amount);
        }
    }
}
