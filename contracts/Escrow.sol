// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/Address.sol";

contract Escrow is Ownable, ReentrancyGuard, Pausable {
    struct Deal {
        address payer;
        address payee;
        uint256 amount;
        bool deposited;
        bool released;
        bool refunded;
    }

    uint256 public dealCounter;
    mapping(uint256 => Deal) public deals;

    event DealCreated(uint256 indexed dealId, address indexed payer, address indexed payee, uint256 amount);
    event Deposited(uint256 indexed dealId, uint256 amount);
    event Released(uint256 indexed dealId);
    event Refunded(uint256 indexed dealId);

    function createDeal(address payer, address payee, uint256 amount) external onlyOwner returns (uint256) {
        require(payer != address(0) && payee != address(0), "invalid address");
        require(amount > 0, "amount 0");
        dealCounter += 1;
        deals[dealCounter] = Deal({
            payer: payer,
            payee: payee,
            amount: amount,
            deposited: false,
            released: false,
            refunded: false
        });
        emit DealCreated(dealCounter, payer, payee, amount);
        return dealCounter;
    }

    function deposit(uint256 dealId) external payable nonReentrant whenNotPaused {
        Deal storage deal = deals[dealId];
        require(msg.sender == deal.payer, "Only payer can deposit");
        require(!deal.deposited, "Already deposited");
        require(msg.value == deal.amount, "Incorrect deposit amount");
        require(msg.value > 0, "Deposit amount must be positive");
        
        deal.deposited = true;
        emit Deposited(dealId, msg.value);
    }

    // Emergency functions
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function release(uint256 dealId) external onlyOwner nonReentrant whenNotPaused {
        Deal storage deal = deals[dealId];
        require(deal.deposited && !deal.released && !deal.refunded, "Invalid deal state");
        require(deal.payee != address(0), "Invalid payee address");
        
        deal.released = true;
        Address.sendValue(payable(deal.payee), deal.amount);
        
        emit Released(dealId);
    }

    function refund(uint256 dealId) external onlyOwner nonReentrant whenNotPaused {
        Deal storage deal = deals[dealId];
        require(deal.deposited && !deal.released && !deal.refunded, "Invalid deal state");
        require(deal.payer != address(0), "Invalid payer address");
        
        deal.refunded = true;
        Address.sendValue(payable(deal.payer), deal.amount);
        
        emit Refunded(dealId);
    }
}
