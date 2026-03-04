const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SmartAccountFactory", function () {
    let entryPoint, factory;
    let owner, other;

    beforeEach(async function () {
        [owner, other] = await ethers.getSigners();

        const EntryPointSimulator = await ethers.getContractFactory("EntryPointSimulator");
        entryPoint = await EntryPointSimulator.deploy();

        const SmartAccountFactory = await ethers.getContractFactory("SmartAccountFactory");
        factory = await SmartAccountFactory.deploy(await entryPoint.getAddress());
    });

    describe("Account Creation", function () {
        it("should create an account at a deterministic address", async function () {
            const predicted = await factory.computeAddress(owner.address, 0);
            const tx = await factory.createAccount(owner.address, 0);
            await tx.wait();

            // Check that code exists at the predicted address
            const code = await ethers.provider.getCode(predicted);
            expect(code).to.not.equal("0x");
        });

        it("should return the same address for duplicate create", async function () {
            await factory.createAccount(owner.address, 0);
            const addr1 = await factory.computeAddress(owner.address, 0);

            await factory.createAccount(owner.address, 0);
            const addr2 = await factory.computeAddress(owner.address, 0);

            expect(addr1).to.equal(addr2);
        });

        it("should create different accounts for different salts", async function () {
            await factory.createAccount(owner.address, 0);
            await factory.createAccount(owner.address, 1);

            const addr1 = await factory.computeAddress(owner.address, 0);
            const addr2 = await factory.computeAddress(owner.address, 1);

            expect(addr1).to.not.equal(addr2);
        });

        it("should create different accounts for different owners", async function () {
            await factory.createAccount(owner.address, 0);
            await factory.createAccount(other.address, 0);

            const addr1 = await factory.computeAddress(owner.address, 0);
            const addr2 = await factory.computeAddress(other.address, 0);

            expect(addr1).to.not.equal(addr2);
        });

        it("should initialize the account with the correct owner", async function () {
            await factory.createAccount(owner.address, 0);
            const accountAddress = await factory.computeAddress(owner.address, 0);
            const account = await ethers.getContractAt("SmartAccount", accountAddress);

            expect(await account.owner()).to.equal(owner.address);
        });

        it("should emit AccountCreated event", async function () {
            const predicted = await factory.computeAddress(owner.address, 42);
            await expect(factory.createAccount(owner.address, 42))
                .to.emit(factory, "AccountCreated")
                .withArgs(predicted, owner.address, 42);
        });
    });

    describe("Implementation", function () {
        it("should have an immutable implementation contract", async function () {
            const impl = await factory.accountImplementation();
            expect(impl).to.not.equal(ethers.ZeroAddress);
        });
    });
});
