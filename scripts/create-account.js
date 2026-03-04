const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Creating SmartAccount with deployer:", deployer.address);

    const factoryAddress = process.env.FACTORY_ADDRESS;
    if (!factoryAddress) {
        console.error("ERROR: Set FACTORY_ADDRESS in .env");
        process.exit(1);
    }

    const owner = process.env.ACCOUNT_OWNER || deployer.address;
    const salt = process.env.ACCOUNT_SALT || 0;

    console.log("Factory:", factoryAddress);
    console.log("Owner:", owner);
    console.log("Salt:", salt);

    // Get factory contract
    const factory = await hre.ethers.getContractAt("SmartAccountFactory", factoryAddress);

    // Predict the account address
    const predictedAddress = await factory.computeAddress(owner, salt);
    console.log("Predicted account address:", predictedAddress);

    // Check if already deployed
    const code = await hre.ethers.provider.getCode(predictedAddress);
    if (code !== "0x") {
        console.log("Account already deployed at:", predictedAddress);
        return;
    }

    // Create the account
    const tx = await factory.createAccount(owner, salt);
    const receipt = await tx.wait();
    console.log("Account created! Tx hash:", receipt.hash);

    // Fund the account with some ETH
    const fundAmount = hre.ethers.parseEther("0.01");
    const fundTx = await deployer.sendTransaction({
        to: predictedAddress,
        value: fundAmount,
    });
    await fundTx.wait();
    console.log("Funded account with", hre.ethers.formatEther(fundAmount), "ETH");

    console.log("\nSmartAccount creation complete!");
    console.log("Account address:", predictedAddress);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
