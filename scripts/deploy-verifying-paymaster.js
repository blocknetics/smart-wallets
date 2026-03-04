const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying VerifyingPaymaster with deployer:", deployer.address);

    // EntryPoint address — set from env or use canonical address
    const entryPointAddress = process.env.ENTRYPOINT_ADDRESS
        || "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

    // The verifying signer — defaults to deployer for testing
    const signerAddress = process.env.PAYMASTER_SIGNER || deployer.address;

    console.log("EntryPoint:", entryPointAddress);
    console.log("Verifying Signer:", signerAddress);

    // Deploy VerifyingPaymaster
    const VerifyingPaymaster = await hre.ethers.getContractFactory("VerifyingPaymaster");
    const paymaster = await VerifyingPaymaster.deploy(entryPointAddress, signerAddress);
    await paymaster.waitForDeployment();

    const paymasterAddress = await paymaster.getAddress();
    console.log("VerifyingPaymaster deployed to:", paymasterAddress);

    // Deposit ETH to EntryPoint for the paymaster
    const depositAmount = hre.ethers.parseEther("0.1");
    const depositTx = await paymaster.deposit({ value: depositAmount });
    await depositTx.wait();
    console.log("Deposited", hre.ethers.formatEther(depositAmount), "ETH to EntryPoint");

    // Stake ETH (required for paymasters that access global state)
    const stakeTx = await paymaster.addStake(86400, { value: depositAmount });
    await stakeTx.wait();
    console.log("Staked", hre.ethers.formatEther(depositAmount), "ETH (1 day unstake delay)");

    console.log("\nVerifyingPaymaster deployment complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
