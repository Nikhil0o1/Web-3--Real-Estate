const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();

  // Core singletons only. SecurityToken is deployed per-property via the admin API.
  const PropertyNFT = await ethers.getContractFactory("PropertyNFT");
  const propertyNFT = await PropertyNFT.deploy();
  await propertyNFT.waitForDeployment();

  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();

  const RentDistribution = await ethers.getContractFactory("RentDistribution");
  const rentDistribution = await RentDistribution.deploy();
  await rentDistribution.waitForDeployment();

  const deployBlock = await ethers.provider.getBlockNumber();

  const addresses = {
    PropertyNFT: await propertyNFT.getAddress(),
    Escrow: await escrow.getAddress(),
    RentDistribution: await rentDistribution.getAddress(),
    Deployer: deployer.address,
    DeployBlock: deployBlock
  };

  const outPath = path.join(__dirname, "..", "backend", "config", "contract-addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));

  console.log("Deployed contracts:");
  console.log(addresses);
  console.log(`Network: ${network.name}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
