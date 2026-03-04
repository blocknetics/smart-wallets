const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenPaymaster", function () {
    let entryPoint, paymaster, token, oracle;
    let owner, user;

    const PRICE = ethers.parseEther("2000"); // 2000 tokens per ETH
    const MARKUP = 11000; // 10% markup (110% of base price)

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();

        // Deploy EntryPoint
        const EntryPointSimulator = await ethers.getContractFactory("EntryPointSimulator");
        entryPoint = await EntryPointSimulator.deploy();

        // Deploy MockERC20
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        token = await MockERC20.deploy("Test Token", "TST", 18);

        // Deploy MockOracle
        const MockOracle = await ethers.getContractFactory("MockOracle");
        oracle = await MockOracle.deploy(PRICE);

        // Deploy TokenPaymaster
        const TokenPaymaster = await ethers.getContractFactory("TokenPaymaster");
        paymaster = await TokenPaymaster.deploy(
            await entryPoint.getAddress(),
            await token.getAddress(),
            await oracle.getAddress(),
            MARKUP
        );

        // Fund the paymaster with ETH
        await paymaster.deposit({ value: ethers.parseEther("1") });
    });

    describe("Initialization", function () {
        it("should set the correct token", async function () {
            expect(await paymaster.token()).to.equal(await token.getAddress());
        });

        it("should set the correct oracle", async function () {
            expect(await paymaster.oracle()).to.equal(await oracle.getAddress());
        });

        it("should set the correct price markup", async function () {
            expect(await paymaster.priceMarkup()).to.equal(MARKUP);
        });
    });

    describe("Token Cost Calculation", function () {
        it("should calculate token cost correctly", async function () {
            const ethAmount = ethers.parseEther("0.001"); // 0.001 ETH
            const cost = await paymaster.getTokenCost(ethAmount);

            // Expected: (0.001 * 2000 * 11000) / 10000 = 2.2 tokens
            const expectedCost = (ethAmount * PRICE * BigInt(MARKUP)) / (ethers.parseEther("1") * 10000n);
            expect(cost).to.equal(expectedCost);
        });
    });

    describe("Configuration", function () {
        it("should allow owner to update config", async function () {
            const newToken = await (await ethers.getContractFactory("MockERC20")).deploy("New", "NEW", 18);
            const newOracle = await (await ethers.getContractFactory("MockOracle")).deploy(1000n);

            await paymaster.setConfig(await newToken.getAddress(), await newOracle.getAddress(), 12000);

            expect(await paymaster.token()).to.equal(await newToken.getAddress());
            expect(await paymaster.oracle()).to.equal(await newOracle.getAddress());
            expect(await paymaster.priceMarkup()).to.equal(12000);
        });

        it("should reject config update from non-owner", async function () {
            await expect(
                paymaster.connect(user).setConfig(
                    await token.getAddress(),
                    await oracle.getAddress(),
                    12000
                )
            ).to.be.reverted;
        });
    });

    describe("Token Withdrawal", function () {
        it("should allow owner to withdraw tokens", async function () {
            // Mint tokens to paymaster
            await token.mint(await paymaster.getAddress(), ethers.parseEther("100"));

            await paymaster.withdrawTokens(owner.address, ethers.parseEther("50"));
            const balance = await token.balanceOf(owner.address);
            expect(balance).to.equal(ethers.parseEther("50"));
        });
    });
});
