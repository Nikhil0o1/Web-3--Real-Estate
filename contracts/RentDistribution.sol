// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title RentDistribution
 * @notice Handles tenant rent payments and automatically distributes ETH
 *         to property-token investors proportional to their ERC-20 ownership.
 *
 *  Flow:
 *    1. Admin calls registerProperty() to link a propertyId to its SecurityToken.
 *    2. Admin calls setMonthlyRent() to define the rent amount in wei.
 *    3. Tenant calls payRent(propertyId) with msg.value >= monthlyRent.
 *    4. The contract iterates over known investors and pushes ETH to each
 *       based on:  investorShare = balanceOf(investor) / totalSupply()
 *    5. Events are emitted for backend indexing.
 */
contract RentDistribution is Ownable, ReentrancyGuard, Pausable {

    // ── Structs ──────────────────────────────────────────────────────
    struct PropertyInfo {
        address tokenContract;      // SecurityToken (ERC-20) address
        uint256 monthlyRentWei;     // rent amount in wei
        bool    active;
    }

    // ── State ────────────────────────────────────────────────────────
    mapping(uint256 => PropertyInfo) public properties;         // propertyId => info
    mapping(uint256 => address[])    internal _investors;       // propertyId => investor list
    mapping(uint256 => mapping(address => bool)) internal _isInvestor; // dedup guard
    mapping(address => uint256) public claimableRewards;
    mapping(uint256 => mapping(address => uint256)) public propertyClaimableRewards;
    mapping(address => uint256) public totalClaimedRewards;
    mapping(uint256 => mapping(address => uint256)) public propertyClaimedRewards;

    uint256 public totalRentCollected;
    uint256 public totalRentDistributed;

    // ── Events (indexed for backend) ─────────────────────────────────
    event PropertyRegistered(uint256 indexed propertyId, address tokenContract);
    event MonthlyRentSet(uint256 indexed propertyId, uint256 rentWei);
    event InvestorAdded(uint256 indexed propertyId, address indexed investor);

    event RentPaid(
        uint256 indexed propertyId,
        address indexed tenant,
        uint256 amount
    );

    event InvestorPaid(
        uint256 indexed propertyId,
        address indexed investor,
        uint256 amount,
        uint256 ownershipBps   // basis-points (10000 = 100%)
    );

    event RentDistributed(
        uint256 indexed propertyId,
        uint256 totalAmount,
        uint256 investorCount
    );

    event RewardsAccrued(
        uint256 indexed propertyId,
        address indexed investor,
        uint256 amount,
        uint256 ownershipBps
    );

    event RewardsClaimed(
        uint256 indexed propertyId,
        address indexed investor,
        uint256 amount
    );

    // ── Admin: register property ─────────────────────────────────────
    function registerProperty(uint256 propertyId, address tokenContract) external onlyOwner {
        require(tokenContract != address(0), "Invalid token contract address");
        require(!properties[propertyId].active, "Property already registered");
        require(propertyId > 0, "Invalid property ID");
        
        properties[propertyId] = PropertyInfo({
            tokenContract: tokenContract,
            monthlyRentWei: 0,
            active: true
        });
        emit PropertyRegistered(propertyId, tokenContract);
    }

    // ── Admin: set monthly rent ──────────────────────────────────────
    function setMonthlyRent(uint256 propertyId, uint256 rentWei) external onlyOwner {
        require(properties[propertyId].active, "Property not registered");
        require(rentWei > 0, "Rent amount must be positive");
        require(rentWei <= 100 ether, "Rent amount too high"); // Reasonable upper limit
        
        properties[propertyId].monthlyRentWei = rentWei;
        emit MonthlyRentSet(propertyId, rentWei);
    }

    // ── Admin / backend: register known investor addresses ───────────
    function addInvestor(uint256 propertyId, address investor) external onlyOwner {
        require(properties[propertyId].active, "Property not registered");
        require(investor != address(0), "Invalid investor address");
        require(_investors[propertyId].length < 1000, "Too many investors");
        
        if (!_isInvestor[propertyId][investor]) {
            _isInvestor[propertyId][investor] = true;
            _investors[propertyId].push(investor);
            emit InvestorAdded(propertyId, investor);
        }
    }

    // ── Batch-add investors ──────────────────────────────────────────
    function addInvestors(uint256 propertyId, address[] calldata investors) external onlyOwner {
        require(properties[propertyId].active, "Property not registered");
        require(investors.length > 0, "No investors provided");
        require(_investors[propertyId].length + investors.length <= 1000, "Too many investors");
        
        for (uint256 i = 0; i < investors.length; i++) {
            address inv = investors[i];
            if (inv != address(0) && !_isInvestor[propertyId][inv]) {
                _isInvestor[propertyId][inv] = true;
                _investors[propertyId].push(inv);
                emit InvestorAdded(propertyId, inv);
            }
        }
    }

    // Emergency functions
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ── Tenant: pay rent ─────────────────────────────────────────────
    function payRent(uint256 propertyId) external payable nonReentrant whenNotPaused {
        PropertyInfo storage prop = properties[propertyId];
        require(prop.active, "Property not registered");
        require(prop.monthlyRentWei > 0, "Rent not set for property");
        require(msg.value >= prop.monthlyRentWei, "Insufficient rent payment");
        require(msg.value <= prop.monthlyRentWei * 2, "Excessive payment amount");
        
        uint256 rentAmount = prop.monthlyRentWei;
        address[] storage invList = _investors[propertyId];
        require(invList.length > 0, "No investors registered for property");
        require(invList.length <= 1000, "Too many investors"); // Prevent gas limit issues
        
        // Cache external calls to avoid multiple SLOADs
        IERC20 token = IERC20(prop.tokenContract);
        uint256 supply = token.totalSupply();
        require(supply > 0, "No token supply available");
        
        // Effects: Update state before external calls
        totalRentCollected += rentAmount;
        emit RentPaid(propertyId, msg.sender, rentAmount);
        
        // Pre-calculate all payouts to avoid repeated calculations
        uint256[] memory payouts = new uint256[](invList.length);
        uint256[] memory ownershipBps = new uint256[](invList.length);
        uint256 totalDistributed = 0;
        uint256 paidCount = 0;
        
        // Calculate all payouts first (effects)
        for (uint256 i = 0; i < invList.length; i++) {
            address inv = invList[i];
            uint256 balance = token.balanceOf(inv);
            if (balance == 0) continue;
            
            // Use unchecked for gas optimization (safe due to require checks above)
            unchecked {
                ownershipBps[i] = (balance * 10000) / supply;
                payouts[i] = (rentAmount * balance) / supply;
                totalDistributed += payouts[i];
            }
            paidCount++;
        }
        
        // Update state
        for (uint256 i = 0; i < invList.length; i++) {
            uint256 payout = payouts[i];
            if (payout == 0) continue;
            address investor = invList[i];
            claimableRewards[investor] += payout;
            propertyClaimableRewards[propertyId][investor] += payout;
            emit InvestorPaid(propertyId, investor, payout, ownershipBps[i]);
            emit RewardsAccrued(propertyId, investor, payout, ownershipBps[i]);
        }
        
        totalRentDistributed += totalDistributed;
        
        emit RentDistributed(propertyId, totalDistributed, paidCount);
        
        // Refund excess ETH
        uint256 remainder = msg.value - rentAmount;
        if (remainder > 0) {
            Address.sendValue(payable(msg.sender), remainder);
        }
    }

    function claimRewards(uint256 propertyId) external nonReentrant whenNotPaused {
        PropertyInfo storage prop = properties[propertyId];
        require(prop.active, "Property not registered");

        uint256 amount = propertyClaimableRewards[propertyId][msg.sender];
        require(amount > 0, "No claimable rewards");

        propertyClaimableRewards[propertyId][msg.sender] = 0;
        claimableRewards[msg.sender] -= amount;
        propertyClaimedRewards[propertyId][msg.sender] += amount;
        totalClaimedRewards[msg.sender] += amount;

        Address.sendValue(payable(msg.sender), amount);
        emit RewardsClaimed(propertyId, msg.sender, amount);
    }

    // ── View helpers ─────────────────────────────────────────────────
    function getInvestors(uint256 propertyId) external view returns (address[] memory) {
        return _investors[propertyId];
    }

    function getInvestorCount(uint256 propertyId) external view returns (uint256) {
        return _investors[propertyId].length;
    }

    function isInvestor(uint256 propertyId, address account) external view returns (bool) {
        return _isInvestor[propertyId][account];
    }

    function getPropertyInfo(uint256 propertyId) external view returns (
        address tokenContract,
        uint256 monthlyRentWei,
        bool active,
        uint256 investorCount
    ) {
        PropertyInfo storage p = properties[propertyId];
        return (p.tokenContract, p.monthlyRentWei, p.active, _investors[propertyId].length);
    }

    function calculateDistribution(uint256 propertyId, uint256 rentAmount)
        external view returns (address[] memory investors, uint256[] memory payouts, uint256[] memory bps)
    {
        PropertyInfo storage prop = properties[propertyId];
        require(prop.active, "Property not registered");
        require(rentAmount > 0, "Rent amount must be positive");
        
        IERC20 token = IERC20(prop.tokenContract);
        uint256 supply = token.totalSupply();
        require(supply > 0, "No token supply available");
        
        address[] storage invList = _investors[propertyId];
        investors = new address[](invList.length);
        payouts = new uint256[](invList.length);
        bps = new uint256[](invList.length);
        
        for (uint256 i = 0; i < invList.length; i++) {
            investors[i] = invList[i];
            uint256 bal = token.balanceOf(invList[i]);
            bps[i] = supply > 0 ? (bal * 10000) / supply : 0;
            payouts[i] = supply > 0 ? (rentAmount * bal) / supply : 0;
        }
    }

    // Allow contract to receive ETH directly (fallback)
    receive() external payable {}
}
