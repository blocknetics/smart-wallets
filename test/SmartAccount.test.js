const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SmartAccount", function () {
    let entryPoint, factory, account;
    let owner, other;

    beforeEach(async function () {
        [owner, other] = await ethers.getSigners();

        // Deploy EntryPointSimulator
        const EntryPointSimulator = await ethers.getContractFactory("EntryPointSimulator");
        entryPoint = await EntryPointSimulator.deploy();

        // Deploy SmartAccountFactory
        const SmartAccountFactory = await ethers.getContractFactory("SmartAccountFactory");
        factory = await SmartAccountFactory.deploy(await entryPoint.getAddress());

        // Create a SmartAccount
        const tx = await factory.createAccount(owner.address, 0);
        await tx.wait();
        const accountAddress = await factory.computeAddress(owner.address, 0);
        account = await ethers.getContractAt("SmartAccount", accountAddress);

        // Fund the account
        await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("1") });
    });

    describe("Initialization", function () {
        it("should set the correct owner", async function () {
            expect(await account.owner()).to.equal(owner.address);
        });

        it("should set the correct EntryPoint", async function () {
            expect(await account.entryPoint()).to.equal(await entryPoint.getAddress());
        });

        it("should receive ETH", async function () {
            const balance = await ethers.provider.getBalance(await account.getAddress());
            expect(balance).to.equal(ethers.parseEther("1"));
        });
    });

    describe("Execution", function () {
        it("should allow owner to execute a call", async function () {
            // Transfer ETH from account to `other`
            const tx = await account.execute(other.address, ethers.parseEther("0.1"), "0x");
            await tx.wait();

            // `other` received the ETH (they start with 10000 ETH in hardhat)
            const balance = await ethers.provider.getBalance(await account.getAddress());
            expect(balance).to.equal(ethers.parseEther("0.9"));
        });

        it("should allow owner to execute a batch", async function () {
            const calls = [
                { target: other.address, value: ethers.parseEther("0.1"), data: "0x" },
                { target: other.address, value: ethers.parseEther("0.2"), data: "0x" },
            ];

            const tx = await account.executeBatch(calls);
            await tx.wait();

            const balance = await ethers.provider.getBalance(await account.getAddress());
            expect(balance).to.equal(ethers.parseEther("0.7"));
        });

        it("should reject execution from non-owner", async function () {
            await expect(
                account.connect(other).execute(other.address, ethers.parseEther("0.1"), "0x")
            ).to.be.reverted;
        });
    });

    describe("UserOp Validation", function () {
        it("should validate a valid owner signature via EntryPoint", async function () {
            // Build a UserOp
            const accountAddr = await account.getAddress();
            const epAddr = await entryPoint.getAddress();

            const userOp = {
                sender: accountAddr,
                nonce: 0n,
                initCode: "0x",
                callData: "0x",
                accountGasLimits: ethers.zeroPadValue(ethers.toBeHex((200000n << 128n) | 100000n), 32),
                preVerificationGas: 50000n,
                gasFees: ethers.zeroPadValue(ethers.toBeHex((1000000000n << 128n) | 1000000000n), 32),
                paymasterAndData: "0x",
                signature: "0x",
            };

            // Get the UserOp hash from the EntryPoint
            const userOpHash = await entryPoint.getUserOpHash(userOp);

            // Sign the hash with the owner
            const signature = await owner.signMessage(ethers.getBytes(userOpHash));
            userOp.signature = signature;

            // Submit the UserOp through EntryPoint
            // The EntryPoint calls validateUserOp and then executes
            const tx = await entryPoint.handleOps([userOp], owner.address);
            const receipt = await tx.wait();

            // Check that the UserOperationEvent was emitted
            const events = receipt.logs.filter(
                (log) => log.fragment && log.fragment.name === "UserOperationEvent"
            );
            expect(events.length).to.be.greaterThan(0);
        });
    });

    describe("Module Management", function () {
        it("should allow owner to enable a module", async function () {
            await account.enableModule(other.address);
            expect(await account.modules(other.address)).to.be.true;
        });

        it("should allow owner to disable a module", async function () {
            await account.enableModule(other.address);
            await account.disableModule(other.address);
            expect(await account.modules(other.address)).to.be.false;
        });

        it("should reject module enable from non-owner", async function () {
            await expect(
                account.connect(other).enableModule(other.address)
            ).to.be.reverted;
        });
    });

    describe("Ownership", function () {
        it("should allow owner to transfer ownership", async function () {
            await account.transferOwnership(other.address);
            expect(await account.owner()).to.equal(other.address);
        });

        it("should reject transfer to zero address", async function () {
            await expect(
                account.transferOwnership(ethers.ZeroAddress)
            ).to.be.reverted;
        });
    });

    describe("Deposits", function () {
        it("should add deposit to EntryPoint", async function () {
            await account.addDeposit({ value: ethers.parseEther("0.5") });
            const deposit = await account.getDeposit();
            expect(deposit).to.equal(ethers.parseEther("0.5"));
        });
    });
});
