// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract RentalYieldDistributor is Ownable, ReentrancyGuard, Pausable {
    IERC20 public immutable securityToken;
    IERC20 public immutable rentToken;

    uint256 public accRentPerToken;
    mapping(address => uint256) public rewardDebt;
    mapping(address => uint256) public pendingRewards;

    event RentDeposited(address indexed from, uint256 amount);
    event RentClaimed(address indexed account, uint256 amount);

    constructor(address securityToken_, address rentToken_) {
        require(securityToken_ != address(0) && rentToken_ != address(0), "invalid address");
        securityToken = IERC20(securityToken_);
        rentToken = IERC20(rentToken_);
    }

    function depositRent(uint256 amount) external onlyOwner nonReentrant whenNotPaused {
        require(amount > 0, "Deposit amount must be positive");
        uint256 totalSupply = securityToken.totalSupply();
        require(totalSupply > 0, "No token supply available");
        
        // Check allowance before transfer
        require(rentToken.allowance(msg.sender, address(this)) >= amount, "Insufficient allowance");
        
        bool ok = rentToken.transferFrom(msg.sender, address(this), amount);
        require(ok, "Rent token transfer failed");
        
        accRentPerToken += (amount * 1e18) / totalSupply;
        emit RentDeposited(msg.sender, amount);
    }

    function claim() external nonReentrant whenNotPaused {
        uint256 balance = securityToken.balanceOf(msg.sender);
        require(balance > 0, "No tokens owned");
        
        uint256 accumulated = (balance * accRentPerToken) / 1e18;
        uint256 pending = accumulated - rewardDebt[msg.sender];
        uint256 payout = pendingRewards[msg.sender] + pending;
        require(payout > 0, "No rewards available to claim");
        require(rentToken.balanceOf(address(this)) >= payout, "Insufficient contract balance");
        
        // Effects before interactions
        pendingRewards[msg.sender] = 0;
        rewardDebt[msg.sender] = accumulated;
        
        // Interaction
        bool ok = rentToken.transfer(msg.sender, payout);
        require(ok, "Reward transfer failed");
        
        emit RentClaimed(msg.sender, payout);
    }

    function onTokenTransfer(address from, address to, uint256 amount) external {
        require(msg.sender == address(securityToken), "Only security token can call");
        if (from != address(0)) {
            _harvestAndUpdate(from, amount, true);
        }
        if (to != address(0)) {
            _harvestAndUpdate(to, amount, false);
        }
    }

    // Emergency functions
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _harvestAndUpdate(address account, uint256 amount, bool fromSide) internal {
        uint256 newBalance = securityToken.balanceOf(account);
        uint256 oldBalance = fromSide ? newBalance + amount : newBalance - amount;
        uint256 accumulated = (oldBalance * accRentPerToken) / 1e18;
        uint256 pending = accumulated - rewardDebt[account];
        if (pending > 0) {
            pendingRewards[account] += pending;
        }
        rewardDebt[account] = (newBalance * accRentPerToken) / 1e18;
    }
}
