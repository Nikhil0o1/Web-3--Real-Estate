/**
 * EstateChain Web3 Client — Phase E consolidation
 * Centralized MetaMask + ethers.js layer with provider management,
 * connection state, and common contract interactions.
 */
(function (global) {
  'use strict';

  // Chain configuration
  const EXPECTED_CHAIN_ID = 11155111;
  const EXPECTED_CHAIN_HEX = '0x' + EXPECTED_CHAIN_ID.toString(16);
  const SEPOLIA_CHAIN_NAME = 'Sepolia Testnet';
  const CHAIN_NAMES = {
    1: 'Ethereum Mainnet',
    11155111: 'Sepolia Testnet',
    137: 'Polygon',
    80001: 'Mumbai Testnet',
    42161: 'Arbitrum One',
    10: 'Optimism',
  };

  // ABIs (minimal, readable)
  const SECURITY_TOKEN_ABI = [
    'function propertyId() view returns (uint256)',
    'function salePricePerTokenWei() view returns (uint256)',
    'function invest(uint256 propertyId, uint256 tokenAmount) payable',
    'function balanceOf(address account) view returns (uint256)',
    'function totalSupply() view returns (uint256)',
    'function decimals() view returns (uint8)',
    'event InvestmentCompleted(address indexed investor, uint256 indexed propertyId, uint256 tokenAmount, uint256 ethSpent)',
  ];

  const RENT_DISTRIBUTION_ABI = [
    'function payRent(uint256 propertyId) payable',
    'function claimRewards(uint256 propertyId)',
    'function claimableRewards(address investor) view returns (uint256)',
    'function propertyClaimableRewards(uint256 propertyId, address investor) view returns (uint256)',
    'function totalClaimedRewards(address investor) view returns (uint256)',
    'function getPropertyInfo(uint256 propertyId) view returns (address tokenContract, uint256 monthlyRentWei, bool active, uint256 investorCount)',
    'function calculateDistribution(uint256 propertyId, uint256 rentAmount) view returns (address[] investors, uint256[] payouts, uint256[] bps)',
    'function getInvestors(uint256 propertyId) view returns (address[])',
    'function registerProperty(address tokenContract, uint256 monthlyRentWei)',
    'function setMonthlyRent(uint256 propertyId, uint256 rentWei)',
    'function addInvestor(uint256 propertyId, address investor)',
    'event RentPaid(uint256 indexed propertyId, address indexed tenant, uint256 amount)',
    'event InvestorPaid(uint256 indexed propertyId, address indexed investor, uint256 amount, uint256 ownershipBps)',
    'event RentDistributed(uint256 indexed propertyId, uint256 totalAmount, uint256 investorCount)',
    'event RewardsAccrued(uint256 indexed propertyId, address indexed investor, uint256 amount, uint256 ownershipBps)',
    'event RewardsClaimed(uint256 indexed propertyId, address indexed investor, uint256 amount)',
  ];

  const PROPERTY_NFT_ABI = [
    'function mint(address to, string memory uri) returns (uint256)',
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function tokenURI(uint256 tokenId) view returns (string memory)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  ];

  const ESCROW_ABI = [
    'function createDeal(address payee, uint256 amount) returns (uint256 dealId)',
    'function deposit(uint256 dealId) payable',
    'function release(uint256 dealId)',
    'function refund(uint256 dealId)',
    'event DealCreated(uint256 indexed dealId, address indexed payer, address indexed payee, uint256 amount)',
    'event Deposited(uint256 indexed dealId, uint256 amount)',
    'event Released(uint256 indexed dealId, uint256 amount)',
    'event Refunded(uint256 indexed dealId, uint256 amount)',
  ];

  // Internal state
  let _provider = null;
  let _signer = null;
  let _ethers = null;
  const _contractCache = new Map();

  // Wallet state (mirrors old utils.js for compatibility)
  const wallet = {
    connected: false,
    address: null,
    balance: null,
    balanceWei: null,
    chainId: null,
    chainOk: true,
    accounts: [],
    _listeners: [],
    onChange(cb) {
      if (typeof cb === 'function') this._listeners.push(cb);
    },
    _notify() {
      this._listeners.forEach((fn) => {
        try {
          fn(this);
        } catch (e) {
          console.error('[web3.js] wallet listener error:', e);
        }
      });
    },
  };

  function hasMetaMask() {
    return typeof global.ethereum !== 'undefined' && global.ethereum.isMetaMask;
  }

  function hasAnyProvider() {
    return typeof global.ethereum !== 'undefined';
  }

  function getEthers() {
    if (!global.ethers) throw new Error('ethers.js not loaded');
    return global.ethers;
  }

  function getChainName(chainIdHexOrNum) {
    const id = typeof chainIdHexOrNum === 'string' ? parseInt(chainIdHexOrNum, 16) : Number(chainIdHexOrNum);
    return CHAIN_NAMES[id] || `Chain ${id}`;
  }

  function isExpectedChain(chainIdHex) {
    return chainIdHex?.toLowerCase?.() === EXPECTED_CHAIN_HEX.toLowerCase();
  }

  // Provider initialization
  async function initProvider() {
    if (_provider) return _provider;
    if (!hasAnyProvider()) throw new Error('No Ethereum provider available');
    const ethers = getEthers();
    _provider = new ethers.providers.Web3Provider(global.ethereum, 'any');
    _ethers = ethers;

    // Wire global events once
    global.ethereum.on('accountsChanged', (accounts) => {
      if (!accounts || accounts.length === 0) {
        disconnectWallet();
      } else {
        wallet.address = accounts[0];
        wallet.connected = true;
        refreshBalance();
        wallet._notify();
      }
    });

    global.ethereum.on('chainChanged', (chainId) => {
      wallet.chainId = chainId;
      wallet.chainOk = isExpectedChain(chainId);
      // Reset provider on chain change (per ethers best practice)
      _provider = null;
      _signer = null;
      _contractCache.clear();
      wallet._notify();
    });

    return _provider;
  }

  function getProvider() {
    if (!_provider) throw new Error('Provider not initialized. Call initProvider() first.');
    return _provider;
  }

  function getSigner() {
    if (_signer) return _signer;
    const provider = getProvider();
    _signer = provider.getSigner();
    return _signer;
  }

  // Connection
  async function connectWallet() {
    if (!hasAnyProvider()) throw new Error('MetaMask not installed');
    const ethers = getEthers();
    const provider = await initProvider();

    // Request accounts
    const accounts = await global.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts || accounts.length === 0) throw new Error('No accounts authorized');

    const address = accounts[0];
    const chainId = await global.ethereum.request({ method: 'eth_chainId' });

    wallet.address = address;
    wallet.accounts = accounts.map((a) => ({ address: a, balance_eth: 0 }));
    wallet.connected = true;
    wallet.chainId = chainId;
    wallet.chainOk = isExpectedChain(chainId);

    await refreshBalance();
    wallet._notify();

    return { address, chainId, chainOk: wallet.chainOk };
  }

  async function disconnectWallet() {
    wallet.connected = false;
    wallet.address = null;
    wallet.balance = null;
    wallet.balanceWei = null;
    wallet.accounts = [];
    wallet.chainOk = true;
    _signer = null;
    _contractCache.clear();
    wallet._notify();
  }

  async function refreshBalance() {
    if (!wallet.connected || !wallet.address) return;
    try {
      const provider = getProvider();
      const wei = await provider.getBalance(wallet.address);
      const ethers = getEthers();
      wallet.balanceWei = wei.toString();
      wallet.balance = Number(ethers.utils.formatEther(wei));
      wallet.accounts = wallet.accounts.map((acc) =>
        acc.address.toLowerCase() === wallet.address.toLowerCase()
          ? { ...acc, balance_eth: wallet.balance }
          : acc
      );
    } catch (e) {
      console.warn('[web3.js] refreshBalance failed:', e);
      wallet.balance = null;
      wallet.balanceWei = null;
    }
  }

  async function switchChain(targetChainHex = EXPECTED_CHAIN_HEX) {
    if (!hasAnyProvider()) throw new Error('No provider');
    try {
      await global.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetChainHex }],
      });
    } catch (switchError) {
      // 4902 = chain not added
      if (switchError.code === 4902) {
        await addSepoliaChain();
      } else {
        throw switchError;
      }
    }
  }

  async function addSepoliaChain() {
    await global.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: EXPECTED_CHAIN_HEX,
          chainName: SEPOLIA_CHAIN_NAME,
          nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://ethereum-sepolia.publicnode.com'],
          blockExplorerUrls: ['https://sepolia.etherscan.io'],
        },
      ],
    });
  }

  // Contract helpers
  function getContractAddress(name) {
    const cfg = global.__ESTATECHAIN_CONFIG__ || {};
    const addrs = cfg.CONTRACT_ADDRESSES || cfg.contracts || {};
    return addrs[name] || addrs[name.toLowerCase()];
  }

  function getSecurityTokenContract(tokenAddress, withSigner = false) {
    const ethers = getEthers();
    const signerOrProvider = withSigner ? getSigner() : getProvider();
    return new ethers.Contract(tokenAddress, SECURITY_TOKEN_ABI, signerOrProvider);
  }

  function getRentDistributionContract(withSigner = false) {
    const addr = getContractAddress('RentDistribution');
    if (!addr) throw new Error('RentDistribution address not configured');
    const ethers = getEthers();
    const signerOrProvider = withSigner ? getSigner() : getProvider();
    return new ethers.Contract(addr, RENT_DISTRIBUTION_ABI, signerOrProvider);
  }

  function getPropertyNFTContract(withSigner = false) {
    const addr = getContractAddress('PropertyNFT');
    if (!addr) throw new Error('PropertyNFT address not configured');
    const ethers = getEthers();
    const signerOrProvider = withSigner ? getSigner() : getProvider();
    return new ethers.Contract(addr, PROPERTY_NFT_ABI, signerOrProvider);
  }

  function getEscrowContract(withSigner = false) {
    const addr = getContractAddress('Escrow');
    if (!addr) throw new Error('Escrow address not configured');
    const ethers = getEthers();
    const signerOrProvider = withSigner ? getSigner() : getProvider();
    return new ethers.Contract(addr, ESCROW_ABI, signerOrProvider);
  }

  // Common contract operations
  async function callInvest(tokenAddress, propertyId, tokenAmount, ethValueWei) {
    const contract = getSecurityTokenContract(tokenAddress, true);
    const tx = await contract.invest(propertyId, tokenAmount, {
      value: ethValueWei,
    });
    return tx;
  }

  async function callPayRent(propertyId, ethValueWei) {
    const contract = getRentDistributionContract(true);
    const tx = await contract.payRent(propertyId, { value: ethValueWei });
    return tx;
  }

  async function callClaimRewards(propertyId) {
    const contract = getRentDistributionContract(true);
    const tx = await contract.claimRewards(propertyId);
    return tx;
  }

  async function waitForReceipt(txHash, confirmations = 1, timeoutMs = 120000) {
    const provider = getProvider();
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt && receipt.confirmations >= confirmations) return receipt;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error('Transaction confirmation timeout');
  }

  // Validation helpers
  function isUserRejected(err) {
    return /user denied|user rejected|rejected the request|transaction signature/i.test(
      String(err?.message || err || '')
    );
  }

  function formatBlockchainError(err) {
    if (isUserRejected(err)) return 'Transaction canceled in MetaMask.';
    const m = String(err?.reason || err?.data?.message || err?.message || err || '');
    if (/insufficient funds/i.test(m)) return 'Insufficient ETH balance.';
    if (/cannot estimate gas|UNPREDICTABLE_GAS_LIMIT/i.test(m)) return 'Gas estimation failed.';
    if (/execution reverted|revert/i.test(m)) return m.replace(/^.*revert(?:ed)?:\s*/i, '') || 'Transaction reverted.';
    return m || 'Transaction failed.';
  }

  function validateAddress(addr) {
    try {
      const ethers = getEthers();
      return ethers.utils.getAddress(addr);
    } catch {
      return null;
    }
  }

  // Formatting utilities
  function formatEther(wei) {
    const ethers = getEthers();
    return ethers.utils.formatEther(wei);
  }

  function parseEther(ethStr) {
    const ethers = getEthers();
    return ethers.utils.parseEther(String(ethStr));
  }

  function formatAddress(addr) {
    if (!addr || addr.length < 10) return addr || '--';
    return addr.slice(0, 6) + '...' + addr.slice(-4);
  }

  function formatCurrency(n) {
    const v = Number(n || 0);
    return Number.isFinite(v)
      ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
      : '$0.00';
  }

  // Wallet state guard for UI flows
  async function ensureWalletReady() {
    if (!hasAnyProvider()) {
      throw new Error('MetaMask is not installed. Please install it from metamask.io');
    }
    if (!wallet.connected || !wallet.address) {
      await connectWallet();
    }
    if (!wallet.chainOk) {
      await switchChain();
      // Recheck
      const chainId = await global.ethereum.request({ method: 'eth_chainId' });
      wallet.chainId = chainId;
      wallet.chainOk = isExpectedChain(chainId);
      if (!wallet.chainOk) throw new Error(`Please switch to ${SEPOLIA_CHAIN_NAME}`);
    }
    return { address: wallet.address, provider: getProvider(), signer: getSigner() };
  }

  // Public API
  const EstateChainWeb3 = {
    // State
    wallet,
    // Checks
    hasMetaMask,
    hasAnyProvider,
    // Connection
    initProvider,
    connect: connectWallet,
    disconnect: disconnectWallet,
    refreshBalance,
    switchChain,
    addSepoliaChain,
    // Accessors
    getProvider,
    getSigner,
    getEthers,
    // Contracts
    getSecurityTokenContract,
    getRentDistributionContract,
    getPropertyNFTContract,
    getEscrowContract,
    getContractAddress,
    // Operations
    callInvest,
    callPayRent,
    callClaimRewards,
    waitForReceipt,
    // Validation / formatting
    isUserRejected,
    formatBlockchainError,
    validateAddress,
    formatEther,
    parseEther,
    formatAddress,
    formatCurrency,
    getChainName,
    ensureWalletReady,
    // Constants
    EXPECTED_CHAIN_ID,
    EXPECTED_CHAIN_HEX,
    SEPOLIA_CHAIN_NAME,
  };

  // Namespace guard
  if (global.EstateChainWeb3) {
    console.warn('[web3.js] EstateChainWeb3 already exists; merging.');
  }
  global.EstateChainWeb3 = Object.assign({}, global.EstateChainWeb3, EstateChainWeb3);

  // Legacy window exports (utils.js compatibility)
  global.wallet = wallet;
  global.connectWallet = connectWallet;
  global.disconnectWallet = disconnectWallet;
  global.hasMetaMask = hasMetaMask;
  global.formatAddress = formatAddress;
  global.formatCurrency = formatCurrency;
})(window);
