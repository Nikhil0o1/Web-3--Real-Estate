const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PropertyNFT", function () {
  it("mints a property NFT with metadata", async function () {
    const [owner, investor] = await ethers.getSigners();
    const PropertyNFT = await ethers.getContractFactory("PropertyNFT");
    const nft = await PropertyNFT.deploy();
    await nft.waitForDeployment();

    const tokenUri = "ipfs://property/1";
    const tx = await nft.connect(owner).mintProperty(investor.address, tokenUri);
    await tx.wait();

    expect(await nft.ownerOf(1)).to.equal(investor.address);
    expect(await nft.tokenURI(1)).to.equal(tokenUri);
  });
});

describe("SecurityToken + RentalYieldDistributor", function () {
  it("enforces KYC and distributes rent", async function () {
    const [owner, alice] = await ethers.getSigners();

    const SecurityToken = await ethers.getContractFactory("SecurityToken");
    const token = await SecurityToken.deploy(1, "Property Token", "PROP", ethers.parseEther("0.01"));
    await token.waitForDeployment();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    const RentalYieldDistributor = await ethers.getContractFactory("RentalYieldDistributor");
    const distributor = await RentalYieldDistributor.deploy(await token.getAddress(), await usdc.getAddress());
    await distributor.waitForDeployment();

    await token.connect(owner).setDistributor(await distributor.getAddress());

    await token.connect(owner).setWhitelisted(owner.address, true);
    await token.connect(owner).setWhitelisted(alice.address, true);

    const amount = ethers.parseUnits("100", 18);
    await token.connect(owner).mint(alice.address, amount);

    const rentAmount = ethers.parseUnits("1000", 6);
    await usdc.connect(owner).mint(owner.address, rentAmount);
    await usdc.connect(owner).approve(await distributor.getAddress(), rentAmount);
    await distributor.connect(owner).depositRent(rentAmount);

    const before = await usdc.balanceOf(alice.address);
    await distributor.connect(alice).claim();
    const after = await usdc.balanceOf(alice.address);

    expect(after - before).to.equal(rentAmount);
  });

  it("blocks transfers when KYC fails", async function () {
    const [owner, bob] = await ethers.getSigners();
    const SecurityToken = await ethers.getContractFactory("SecurityToken");
    const token = await SecurityToken.deploy(1, "Property Token", "PROP", ethers.parseEther("0.01"));
    await token.waitForDeployment();

    await token.connect(owner).setWhitelisted(owner.address, true);
    await token.connect(owner).mint(owner.address, ethers.parseUnits("10", 18));

    await expect(token.connect(owner).transfer(bob.address, ethers.parseUnits("1", 18)))
      .to.be.revertedWith("KYC required");
  });
});
