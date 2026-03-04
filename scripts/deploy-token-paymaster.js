const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying TokenPaymaster with deployer:", deployer.address);

    const entryPointAddress = process.env.ENTRYPOINT_ADDRESS
        || "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
    const tokenAddress = process.env.TOKEN_ADDRESS;
    const oracleAddress = process.env.ORACLE_ADDRESS;
    const priceMarkup = process.env.PRICE_MARKUP || 11000; // 10% markup (basis points)

    if (!tokenAddress || !oracleAddress) {
        console.error("ERROR: Set TOKEN_ADDRESS and ORACLE_ADDRESS in .env");
        process.exit(1);
    }

    console.log("EntryPoint:", entryPointAddress);
    console.log("Token:", tokenAddress);
    console.log("Oracle:", oracleAddress);
    console.log("Price Markup:", priceMarkup, "basis points");

    // Deploy TokenPaymaster
    const TokenPaymaster = await hre.ethers.getContractFactory("TokenPaymaster");
    const paymaster = await TokenPaymaster.deploy(
        entryPointAddress,
        tokenAddress,
        oracleAddress,
        priceMarkup
    );
    await paymaster.waitForDeployment();

    const paymasterAddress = await paymaster.getAddress();
    console.log("TokenPaymaster deployed to:", paymasterAddress);

    // Deposit ETH for gas
    const depositAmount = hre.ethers.parseEther("0.1");
    const depositTx = await paymaster.deposit({ value: depositAmount });
    await depositTx.wait();
    console.log("Deposited", hre.ethers.formatEther(depositAmount), "ETH to EntryPoint");

    console.log("\nTokenPaymaster deployment complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
