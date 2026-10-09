// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20Min {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// Test-only stand-in for Textile's LimitOrderReactor. The router fork test etches its runtime
/// code at the reactor address, because a firm Textile quote (signed maker orders) cannot be
/// fetched for a fork wallet. Same settlement shape as an RFQ fill: the reactor pulls the taker's
/// sell token (taker approved it as spender) and pays the buy token to msg.sender.
contract MockRfqReactor {
    function fill(address sellToken, uint256 takerPays, address buyToken, uint256 buyAmount) external {
        require(IERC20Min(sellToken).transferFrom(msg.sender, address(this), takerPays), "pull failed");
        require(IERC20Min(buyToken).transfer(msg.sender, buyAmount), "pay failed");
    }
}
