// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/* solhint-disable reason-string */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@account-abstraction/contracts/core/BasePaymaster.sol";
import "@account-abstraction/contracts/core/UserOperationLib.sol";
import "@account-abstraction/contracts/core/Helpers.sol";
import "../libraries/AccountErrors.sol";

/**
 * @title IOracle
 * @notice Minimal price oracle interface for token/ETH conversion.
 */
interface IOracle {
    /**
     * @notice Get the current token price in ETH (wei per token).
     * @return price The exchange rate: how many wei of ETH one token is worth.
     */
    function getTokenValueOfEth(uint256 ethAmount) external view returns (uint256 price);
}

/**
 * @title TokenPaymaster
 * @notice A paymaster that accepts ERC-20 tokens as gas payment.
 * @dev Users approve the paymaster to spend their tokens. During validation,
 *      the paymaster pre-charges an estimated token amount. During postOp,
 *      it refunds the difference between estimated and actual cost.
 *
 *      paymasterData is empty for this paymaster — it reads the token and
 *      oracle from its own configuration.
 */
contract TokenPaymaster is BasePaymaster {
    using SafeERC20 for IERC20;
    using UserOperationLib for PackedUserOperation;

    /// @notice The accepted ERC-20 token
    IERC20 public token;

    /// @notice Price oracle for token/ETH conversion
    IOracle public oracle;

    /// @notice Price markup in basis points (e.g. 1000 = 10% markup)
    uint32 public priceMarkup;

    /// @notice Denominator for basis point calculations
    uint32 private constant PRICE_DENOMINATOR = 10000;

    event ConfigUpdated(address indexed token, address indexed oracle, uint32 priceMarkup);

    constructor(
        IEntryPoint _entryPoint,
        IERC20 _token,
        IOracle _oracle,
        uint32 _priceMarkup
    ) BasePaymaster(_entryPoint) {
        token = _token;
        oracle = _oracle;
        priceMarkup = _priceMarkup;
    }

    /**
     * @notice Update the token, oracle, and markup configuration.
     */
    function setConfig(
        IERC20 _token,
        IOracle _oracle,
        uint32 _priceMarkup
    ) external onlyOwner {
        if (address(_token) == address(0) || address(_oracle) == address(0)) revert AccountErrors.InvalidTokenOrOracle();
        if (_priceMarkup == 0 || _priceMarkup > 20000) revert AccountErrors.InvalidMarkup();
        token = _token;
        oracle = _oracle;
        priceMarkup = _priceMarkup;
        emit ConfigUpdated(address(_token), address(_oracle), _priceMarkup);
    }

    /**
     * @notice Convert an ETH amount to the equivalent token amount (with markup).
     * @param ethAmount The amount of ETH (wei).
     * @return tokenAmount The equivalent token amount.
     */
    function getTokenCost(uint256 ethAmount) public view returns (uint256 tokenAmount) {
        uint256 tokenPrice = oracle.getTokenValueOfEth(ethAmount);
        tokenAmount = (tokenPrice * priceMarkup) / PRICE_DENOMINATOR;
    }

    /**
     * @dev Pre-charge tokens during validation.
     *      Context encodes: (sender, preChargeAmount, gasPrice)
     */
    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /*userOpHash*/,
        uint256 maxCost
    ) internal override returns (bytes memory context, uint256 validationData) {
        // Calculate pre-charge amount
        uint256 tokenAmount = getTokenCost(maxCost);

        // Verify user has enough tokens
        if (token.balanceOf(userOp.sender) < tokenAmount) {
            revert AccountErrors.InsufficientTokenBalance();
        }

        // Pre-charge: transfer tokens from user to paymaster
        token.safeTransferFrom(userOp.sender, address(this), tokenAmount);

        // Encode context for postOp refund
        context = abi.encode(
            userOp.sender,
            tokenAmount,
            userOp.gasPrice()
        );

        return (context, SIG_VALIDATION_SUCCESS);
    }

    /**
     * @dev Refund excess tokens after execution.
     */
    function _postOp(
        PostOpMode /*mode*/,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 /*actualUserOpFeePerGas*/
    ) internal override {
        (address sender, uint256 preCharge, ) = abi.decode(
            context,
            (address, uint256, uint256)
        );

        // Calculate actual token cost
        uint256 actualTokenCost = getTokenCost(actualGasCost);

        // Refund excess tokens
        if (preCharge > actualTokenCost) {
            token.safeTransfer(sender, preCharge - actualTokenCost);
        }
    }

    /**
     * @notice Withdraw collected tokens.
     * @param to Recipient address.
     * @param amount Amount to withdraw.
     */
    function withdrawTokens(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert AccountErrors.ZeroAddress();
        token.safeTransfer(to, amount);
    }
}
