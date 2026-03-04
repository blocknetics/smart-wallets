const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying SmartAccountFactory with deployer:", deployer.address);

    // Use the canonical EntryPoint v0.7 address, or deploy our simulator for local testing
    let entryPointAddress;

    if (hre.network.name === "hardhat" || hre.network.name === "localhost") {
        // Deploy EntryPointSimulator for local testing
        const EntryPointSimulator = await hre.ethers.getContractFactory("EntryPointSimulator");
        const entryPoint = await EntryPointSimulator.deploy();
        await entryPoint.waitForDeployment();
        entryPointAddress = await entryPoint.getAddress();
        console.log("EntryPointSimulator deployed to:", entryPointAddress);
    } else {
        // Use canonical EntryPoint v0.7 address on live networks
        entryPointAddress = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
        console.log("Using canonical EntryPoint at:", entryPointAddress);
    }

    // Deploy SmartAccountFactory
    const SmartAccountFactory = await hre.ethers.getContractFactory("SmartAccountFactory");
    const factory = await SmartAccountFactory.deploy(entryPointAddress);
    await factory.waitForDeployment();

    const factoryAddress = await factory.getAddress();
    const implAddress = await factory.accountImplementation();

    console.log("SmartAccountFactory deployed to:", factoryAddress);
    console.log("SmartAccount implementation:", implAddress);
    console.log("\nDeployment complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
