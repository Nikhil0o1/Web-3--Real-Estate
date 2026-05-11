const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const RentDistribution = await ethers.getContractFactory("RentDistribution");
  const rentDistribution = await RentDistribution.deploy();
  await rentDistribution.waitForDeployment();

  const deployBlock = await ethers.provider.getBlockNumber();
  const addressesPath = path.join(__dirname, "..", "backend", "config", "contract-addresses.json");
  const existing = fs.existsSync(addressesPath)
    ? JSON.parse(fs.readFileSync(addressesPath, "utf8"))
    : {};

  const updated = {
    ...existing,
    RentDistribution: await rentDistribution.getAddress(),
    Deployer: deployer.address,
    DeployBlock: deployBlock,
  };

  fs.writeFileSync(addressesPath, JSON.stringify(updated, null, 2));

  console.log("Updated contract addresses:");
  console.log(updated);
  console.log(`Network: ${network.name}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
