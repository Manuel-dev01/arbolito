// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

/// Spike: "smart-account taker vs Textile/Permit2".
/// Runs against Textile's deployed LimitOrderReactor on a Celo mainnet fork:
///   forge test --root contracts --match-path "test/fork/*" --fork-url https://forno.celo.org
/// The reactor is UniswapX-style (execute/executeWithCallback/executeBatch, permit2(), feeController()).
/// A swapper's input is pulled by Permit2.permitWitnessTransferFrom, which checks the signature with
/// ecrecover for EOAs and EIP-1271 for contracts. This test executes a LimitOrder whose swapper is a
/// contract wallet (EIP-1271) to confirm the onchain path accepts contract takers.

interface IERC20 {
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IReactor {
    struct SignedOrder {
        bytes order;
        bytes sig;
    }

    function execute(SignedOrder calldata order) external payable;
    function permit2() external view returns (address);
}

// UniswapX LimitOrder encoding.
struct OrderInfo {
    address reactor;
    address swapper;
    uint256 nonce;
    uint256 deadline;
    address additionalValidationContract;
    bytes additionalValidationData;
}

struct InputToken {
    address token;
    uint256 amount;
    uint256 maxAmount;
}

struct OutputToken {
    address token;
    uint256 amount;
    address recipient;
}

struct LimitOrder {
    OrderInfo info;
    InputToken input;
    OutputToken[] outputs;
}

/// Minimal contract wallet: EIP-1271 approves whatever its owner signed (ECDSA over the hash).
contract Mock1271Wallet {
    address public immutable owner;

    constructor(address _owner) {
        owner = _owner;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        (bytes32 r, bytes32 s, uint8 v) = abi.decode(sig, (bytes32, bytes32, uint8));
        return ecrecover(hash, v, r, s) == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    function approve(address token, address spender) external {
        require(msg.sender == owner, "owner");
        IERC20(token).approve(spender, type(uint256).max);
    }
}

contract TextileReactorSmartAccountTest is Test {
    address constant REACTOR = 0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address constant WARS = 0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D;
    address constant WARS_POOL = 0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391; // holds wARS and USDT

    // UniswapX LimitOrderLib type strings (Permit2 witness).
    bytes constant ORDER_INFO_TYPE =
        "OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)";
    bytes constant OUTPUT_TOKEN_TYPE = "OutputToken(address token,uint256 amount,address recipient)";
    bytes constant LIMIT_ORDER_TYPE = abi.encodePacked(
        "LimitOrder(OrderInfo info,address inputToken,uint256 inputAmount,OutputToken[] outputs)",
        ORDER_INFO_TYPE,
        OUTPUT_TOKEN_TYPE
    );
    string constant PERMIT2_ORDER_TYPE = string(
        abi.encodePacked(
            "LimitOrder witness)",
            "LimitOrder(OrderInfo info,address inputToken,uint256 inputAmount,OutputToken[] outputs)",
            ORDER_INFO_TYPE,
            OUTPUT_TOKEN_TYPE,
            "TokenPermissions(address token,uint256 amount)"
        )
    );

    uint256 ownerKey = 0xA11CE;
    address owner;
    Mock1271Wallet wallet;
    address filler = makeAddr("filler");

    function setUp() public {
        // Only meaningful on a Celo fork; skip cleanly otherwise.
        if (block.chainid != 42220 || REACTOR.code.length == 0) vm.skip(true);
        owner = vm.addr(ownerKey);
        wallet = new Mock1271Wallet(owner);
        vm.startPrank(WARS_POOL);
        IERC20(USDT).transfer(address(wallet), 10e6); // taker sells 10 USDT
        IERC20(WARS).transfer(filler, 20_000e18); // maker inventory
        vm.stopPrank();
        vm.prank(owner);
        wallet.approve(USDT, PERMIT2); // one-time Permit2 approval by the smart account
        vm.prank(filler);
        IERC20(WARS).approve(REACTOR, type(uint256).max); // filler pays outputs via transferFrom
    }

    function _hashOrderInfo(OrderInfo memory info) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(ORDER_INFO_TYPE),
                info.reactor,
                info.swapper,
                info.nonce,
                info.deadline,
                info.additionalValidationContract,
                keccak256(info.additionalValidationData)
            )
        );
    }

    function _hashOrder(LimitOrder memory o) internal pure returns (bytes32) {
        bytes32[] memory outs = new bytes32[](o.outputs.length);
        for (uint256 i; i < o.outputs.length; i++) {
            outs[i] = keccak256(
                abi.encode(keccak256(OUTPUT_TOKEN_TYPE), o.outputs[i].token, o.outputs[i].amount, o.outputs[i].recipient)
            );
        }
        return keccak256(
            abi.encode(
                keccak256(LIMIT_ORDER_TYPE),
                _hashOrderInfo(o.info),
                o.input.token,
                o.input.amount,
                keccak256(abi.encodePacked(outs))
            )
        );
    }

    /// Permit2 PermitWitnessTransferFrom digest, as the swapper signs it.
    function _permit2Digest(LimitOrder memory o) internal view returns (bytes32) {
        bytes32 tokenPermissionsTypehash = keccak256("TokenPermissions(address token,uint256 amount)");
        bytes32 typehash = keccak256(
            abi.encodePacked(
                "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,",
                PERMIT2_ORDER_TYPE
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typehash,
                keccak256(abi.encode(tokenPermissionsTypehash, o.input.token, o.input.maxAmount)),
                REACTOR,
                o.info.nonce,
                o.info.deadline,
                _hashOrder(o)
            )
        );
        (bool ok, bytes memory ds) = PERMIT2.staticcall(abi.encodeWithSignature("DOMAIN_SEPARATOR()"));
        require(ok, "domain");
        return keccak256(abi.encodePacked("\x19\x01", abi.decode(ds, (bytes32)), structHash));
    }

    function _order(address swapper, uint256 outAmount) internal view returns (LimitOrder memory o) {
        o.info = OrderInfo(REACTOR, swapper, uint256(keccak256("arbolito-spike")), block.timestamp + 60, address(0), "");
        o.input = InputToken(USDT, 10e6, 10e6);
        o.outputs = new OutputToken[](1);
        o.outputs[0] = OutputToken(WARS, outAmount, swapper);
    }

    function test_contractSwapperOrderExecutes() public {
        LimitOrder memory o = _order(address(wallet), 16_000e18);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, _permit2Digest(o));
        IReactor.SignedOrder memory signed = IReactor.SignedOrder(abi.encode(o), abi.encode(r, s, v));

        uint256 usdtBefore = IERC20(USDT).balanceOf(address(wallet));
        vm.prank(filler);
        IReactor(REACTOR).execute(signed);

        assertEq(usdtBefore - IERC20(USDT).balanceOf(address(wallet)), 10e6, "input pulled from the contract wallet");
        assertGe(IERC20(WARS).balanceOf(address(wallet)), 16_000e18, "output delivered to the contract wallet");
    }

    function test_contractSwapperRejectsForeignSignature() public {
        LimitOrder memory o = _order(address(wallet), 16_000e18);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, _permit2Digest(o)); // not the wallet owner
        IReactor.SignedOrder memory signed = IReactor.SignedOrder(abi.encode(o), abi.encode(r, s, v));
        vm.prank(filler);
        vm.expectRevert();
        IReactor(REACTOR).execute(signed);
    }
}
