// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {ArbolitoSessionExecutor as Guard} from "../../src/ArbolitoSessionExecutor.sol";
import {TickMath} from "../../src/lib/UniswapV3Math.sol";
import {MockAdminAccount} from "../mocks/GuardMocks.sol";
import {OrderInfo, InputToken, OutputToken, LimitOrder} from "./TextileReactorSmartAccount.t.sol";

interface IERC20F {
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
}

interface IPoolF {
    function slot0()
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16 obsIndex, uint16 obsCard, uint16 obsCardNext, uint8, bool);
    function observe(uint32[] calldata) external view returns (int56[] memory, uint160[] memory);
    function token0() external view returns (address);
}

interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (uint256 amountOut, uint160, uint32, uint256);
}

interface IRouterF {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata) external payable returns (uint256);
}

interface IReactorF {
    struct SignedOrder {
        bytes order;
        bytes sig;
    }

    function execute(SignedOrder calldata order) external payable;
}

/// ArbolitoSessionExecutor against the real Uniswap v3 pools, SwapRouter02 and Textile's reactor on a
/// Celo fork:  pnpm contracts:test:fork   (skips cleanly when not on chain 42220)
contract ArbolitoSessionExecutorForkTest is Test {
    address constant ROUTER = 0x5615CDAb10dc425a742d643d949a7F474C01abc4;
    address constant FACTORY = 0xAfE208a311B21f13EF87E33A90049fC17A7acDEc;
    address constant QUOTER = 0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8;
    address constant REACTOR = 0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant WARS = 0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D;
    address constant WBRL = 0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0;
    address constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address constant USAT = 0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771;
    address constant USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;
    address constant WARS_POOL = 0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391;
    address constant WBRL_POOL = 0x01c3cf91cdf7B34181C7eC8566c0236951FEA40F;
    address constant USAT_POOL = 0x070D575a713EaF5025462D0865Fb0Dac4B14bC38;
    uint32 constant WINDOW = 600;
    uint16 constant SLIPPAGE_BPS = 50;

    uint256 adminKey = uint256(keccak256("arbolito guard fork admin"));
    uint256 makerKey = uint256(keccak256("arbolito guard fork maker"));
    Guard guard;
    MockAdminAccount account;
    address contact = makeAddr("contact");
    address stranger = makeAddr("stranger");
    address attacker = makeAddr("attacker");

    function setUp() public {
        if (block.chainid != 42220 || ROUTER.code.length == 0) vm.skip(true);
        address[] memory tokens = new address[](5);
        (tokens[0], tokens[1], tokens[2], tokens[3], tokens[4]) = (WARS, WBRL, USDT, USAT, USDC);
        address[] memory pools = new address[](3);
        (pools[0], pools[1], pools[2]) = (WARS_POOL, WBRL_POOL, USAT_POOL);
        guard = new Guard(ROUTER, FACTORY, REACTOR, WINDOW, tokens, pools);

        account = new MockAdminAccount(vm.addr(adminKey));
        vm.startPrank(WARS_POOL);
        IERC20F(USDT).transfer(address(account), 100e6);
        IERC20F(WARS).transfer(address(account), 100_000e18);
        vm.stopPrank();
        vm.prank(WBRL_POOL);
        IERC20F(WBRL).transfer(address(account), 100e18);
        account.approve(USDT, address(guard), 50e6); // bounded allowances, set by the admin at onboarding
        account.approve(WARS, address(guard), 100_000e18);
        account.approve(WBRL, address(guard), 100e18);

        Guard.ConfigUpdate memory u = _update();
        u.limits = new Guard.TokenLimit[](3);
        u.limits[0] = Guard.TokenLimit(USDT, 20e6, 40e6);
        u.limits[1] = Guard.TokenLimit(WARS, 50_000e18, 100_000e18);
        u.limits[2] = Guard.TokenLimit(WBRL, 50e18, 100e18);
        u.recipients = new Guard.Recipient[](1);
        u.recipients[0] = Guard.Recipient(contact, true);
        _apply(u);
    }

    // ------------------------------------------------------------------ helpers
    function _update() internal view returns (Guard.ConfigUpdate memory u) {
        u.account = address(account);
        (,, u.nonce) = guard.settings(address(account));
        u.deadline = block.timestamp + 1 hours;
        u.maxSlippageBps = SLIPPAGE_BPS;
        u.limits = new Guard.TokenLimit[](0);
        u.recipients = new Guard.Recipient[](0);
        u.prices = new Guard.PriceRef[](0);
    }

    function _apply(Guard.ConfigUpdate memory u) internal {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", guard.DOMAIN_SEPARATOR(), guard.hashConfigUpdate(u)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(adminKey, digest);
        guard.applyConfig(u, abi.encodePacked(r, s, v));
    }

    function _swap(bytes memory path, uint256 amountIn, uint256 minOut) internal returns (uint256) {
        vm.prank(address(account));
        return guard.swapExactInput(path, amountIn, minOut);
    }

    function _quote(address tokenIn, address tokenOut, uint256 amountIn) internal returns (uint256 out) {
        (out,,,) = IQuoterV2(QUOTER).quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams(tokenIn, tokenOut, amountIn, 100, 0)
        );
    }

    /// Writes a fresh observation into a cardinality-1 pool (a pool only writes one when a swap
    /// moves the tick): the oracle then can't cover the window.
    function _pokeWbrlPool() internal {
        (, int24 tickBefore,,,,,) = IPoolF(WBRL_POOL).slot0();
        vm.prank(WARS_POOL);
        IERC20F(USDT).transfer(attacker, 20e6);
        vm.startPrank(attacker);
        IERC20F(USDT).approve(ROUTER, 20e6);
        IRouterF(ROUTER).exactInputSingle(IRouterF.ExactInputSingleParams(USDT, WBRL, 100, attacker, 20e6, 0, 0));
        vm.stopPrank();
        (, int24 tickAfter,,,,,) = IPoolF(WBRL_POOL).slot0();
        assertTrue(tickAfter != tickBefore, "poke moved the tick");
    }

    // ------------------------------------------------------------------ oracle facts
    function test_oracle_cardinalityAndTickMath() public view {
        address[3] memory pools = [WARS_POOL, WBRL_POOL, USAT_POOL];
        for (uint256 i; i < 3; i++) {
            (uint160 sqrtP, int24 tick,, uint16 card, uint16 cardNext,,) = IPoolF(pools[i]).slot0();
            console2.log("pool", pools[i]);
            console2.log("  observationCardinality / next", card, cardNext);
            // Our TickMath port brackets the live sqrtPrice at the live tick.
            assertLe(TickMath.getSqrtRatioAtTick(tick), sqrtP);
            assertGt(TickMath.getSqrtRatioAtTick(tick + 1), sqrtP);
        }
        (,,, uint16 warsCard,,,) = IPoolF(WARS_POOL).slot0();
        (,,, uint16 usatCard,,,) = IPoolF(USAT_POOL).slot0();
        // >= 600 observations, at most one per (1 s) block, always span >= the 600 s window.
        assertGe(warsCard, WINDOW);
        assertGe(usatCard, WINDOW);
        uint32[] memory ago = new uint32[](2);
        ago[0] = WINDOW;
        IPoolF(WARS_POOL).observe(ago);
        IPoolF(USAT_POOL).observe(ago);
    }

    function test_oracle_twapTracksQuoter() public {
        (bool ok, uint256 twapOut) = guard.twapQuote(WARS_POOL, USDT, WARS, 10e6);
        assertTrue(ok);
        uint256 quoted = _quote(USDT, WARS, 10e6);
        console2.log("10 USDT -> wARS: twap", twapOut, "quoter", quoted);
        assertApproxEqRel(quoted, twapOut, 0.01e18); // within 1%
        (ok, twapOut) = guard.twapQuote(USAT_POOL, USDT, USAT, 10e6);
        assertTrue(ok);
        assertApproxEqRel(twapOut, 10e6, 0.01e18); // USA₮ ~ USD₮
    }

    // ------------------------------------------------------------------ swaps
    function test_swap_atFloor_passes_USDTtoWARS() public {
        uint256 floor = guard.minOutFloor(address(account), abi.encodePacked(USDT, uint24(100), WARS), 10e6);
        uint256 quoted = _quote(USDT, WARS, 10e6);
        assertGe(quoted, floor, "live pool clears the 50 bps floor");
        uint256 before = IERC20F(WARS).balanceOf(address(account));
        uint256 out = _swap(abi.encodePacked(USDT, uint24(100), WARS), 10e6, floor);
        assertEq(out, quoted);
        assertEq(IERC20F(WARS).balanceOf(address(account)) - before, out);
        assertEq(IERC20F(USDT).allowance(address(guard), ROUTER), 0, "approval reset");
        assertEq(IERC20F(USDT).balanceOf(address(guard)), 0);
        assertEq(IERC20F(WARS).balanceOf(address(guard)), 0);
    }

    function test_swap_WARStoUSDT_and_USDTtoUSAT() public {
        bytes memory p1 = abi.encodePacked(WARS, uint24(100), USDT);
        _swap(p1, 10_000e18, guard.minOutFloor(address(account), p1, 10_000e18));
        bytes memory p2 = abi.encodePacked(USDT, uint24(100), USAT);
        _swap(p2, 5e6, guard.minOutFloor(address(account), p2, 5e6));
        assertGt(IERC20F(USAT).balanceOf(address(account)), 4.9e6);
    }

    function test_swap_multiHop_WARS_USDT_USAT() public {
        bytes memory path = abi.encodePacked(WARS, uint24(100), USDT, uint24(100), USAT);
        uint256 floor = guard.minOutFloor(address(account), path, 10_000e18);
        _swap(path, 10_000e18, floor);
        assertGe(IERC20F(USAT).balanceOf(address(account)), floor);
    }

    function test_swap_minOutZero_rejected() public {
        bytes memory path = abi.encodePacked(USDT, uint24(100), WARS);
        uint256 floor = guard.minOutFloor(address(account), path, 10e6);
        vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, 0, floor));
        _swap(path, 10e6, 0);
    }

    function test_swap_belowFloor_rejected() public {
        bytes memory path = abi.encodePacked(USDT, uint24(100), WARS);
        uint256 floor = guard.minOutFloor(address(account), path, 10e6);
        vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, floor - 1, floor));
        _swap(path, 10e6, floor - 1);
        // Even at 5% under the TWAP (a "generous" key), still refused.
        vm.expectRevert();
        _swap(path, 10e6, floor * 95 / 100);
    }

    /// A same-block sandwich moves spot but not the TWAP: the floor holds and the victim swap reverts.
    function test_swap_sandwichCannotLowerTheFloor() public {
        bytes memory path = abi.encodePacked(USDT, uint24(100), WARS);
        uint256 floorBefore = guard.minOutFloor(address(account), path, 10e6);
        // Front-run: the attacker buys ~5k USDT of wARS, making wARS dearer for the victim.
        vm.prank(WARS_POOL);
        IERC20F(USDT).transfer(attacker, 5_000e6);
        vm.startPrank(attacker);
        IERC20F(USDT).approve(ROUTER, 5_000e6);
        IRouterF(ROUTER).exactInputSingle(IRouterF.ExactInputSingleParams(USDT, WARS, 100, attacker, 5_000e6, 0, 0));
        vm.stopPrank();
        assertEq(guard.minOutFloor(address(account), path, 10e6), floorBefore, "TWAP unmoved in the same block");
        assertLt(_quote(USDT, WARS, 10e6), floorBefore, "spot now worse than the floor");
        vm.expectRevert(); // router: "Too little received"
        _swap(path, 10e6, floorBefore);
    }

    function test_send_contact_vs_stranger() public {
        vm.prank(address(account));
        guard.send(USDT, contact, 5e6);
        assertEq(IERC20F(USDT).balanceOf(contact), 5e6);
        vm.prank(address(account));
        vm.expectRevert(abi.encodeWithSelector(Guard.NotRecipient.selector, stranger));
        guard.send(USDT, stranger, 1);
    }

    // ------------------------------------------------------------------ wBRL: cardinality 1
    function test_wbrl_lowCardinality_fallsBackToSignedReference() public {
        (,,, uint16 card,,,) = IPoolF(WBRL_POOL).slot0();
        console2.log("wBRL pool observationCardinality", card);
        _pokeWbrlPool(); // any swap in the last 600 s makes observe(600) revert "OLD" when cardinality = 1
        (bool ok,) = guard.twapQuote(WBRL_POOL, WBRL, USDT, 10e18);
        assertFalse(ok);
        bytes memory path = abi.encodePacked(WBRL, uint24(100), USDT);
        vm.expectRevert(abi.encodeWithSelector(Guard.NoPriceReference.selector, WBRL, USDT));
        _swap(path, 10e18, 1);

        // The admin signs a reference price (e.g. from Textile's ticker), valid for 10 minutes.
        uint256 quoted = _quote(WBRL, USDT, 10e18);
        Guard.ConfigUpdate memory u = _update();
        u.prices = new Guard.PriceRef[](1);
        u.prices[0] = Guard.PriceRef(WBRL, USDT, 10e18, uint128(quoted), uint64(block.timestamp + 600));
        _apply(u);
        uint256 floor = guard.minOutFloor(address(account), path, 10e18);
        assertEq(floor, quoted * (10_000 - SLIPPAGE_BPS) / 10_000);
        vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, 0, floor));
        _swap(path, 10e18, 0);
        _swap(path, 10e18, floor);

        // Once 600 s pass with no swap, the cardinality-1 oracle covers the window again (it
        // extrapolates the current tick), and the expired reference no longer applies.
        vm.warp(block.timestamp + 601);
        (ok,) = guard.twapQuote(WBRL_POOL, WBRL, USDT, 10e18);
        assertTrue(ok);
    }

    // ------------------------------------------------------------------ Textile: guard as filler on the real reactor
    bytes constant ORDER_INFO_TYPE =
        "OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)";
    bytes constant OUTPUT_TOKEN_TYPE = "OutputToken(address token,uint256 amount,address recipient)";
    bytes constant LIMIT_ORDER_TYPE = abi.encodePacked(
        "LimitOrder(OrderInfo info,address inputToken,uint256 inputAmount,OutputToken[] outputs)",
        ORDER_INFO_TYPE,
        OUTPUT_TOKEN_TYPE
    );

    function _orderHash(LimitOrder memory o) internal pure returns (bytes32) {
        bytes32[] memory outs = new bytes32[](o.outputs.length);
        for (uint256 i; i < o.outputs.length; i++) {
            outs[i] = keccak256(
                abi.encode(keccak256(OUTPUT_TOKEN_TYPE), o.outputs[i].token, o.outputs[i].amount, o.outputs[i].recipient)
            );
        }
        bytes32 infoHash = keccak256(
            abi.encode(
                keccak256(ORDER_INFO_TYPE),
                o.info.reactor,
                o.info.swapper,
                o.info.nonce,
                o.info.deadline,
                o.info.additionalValidationContract,
                keccak256(o.info.additionalValidationData)
            )
        );
        return keccak256(
            abi.encode(keccak256(LIMIT_ORDER_TYPE), infoHash, o.input.token, o.input.amount, keccak256(abi.encodePacked(outs)))
        );
    }

    function _permit2Digest(LimitOrder memory o) internal view returns (bytes32) {
        bytes32 typehash = keccak256(
            abi.encodePacked(
                "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,",
                "LimitOrder witness)",
                LIMIT_ORDER_TYPE,
                "TokenPermissions(address token,uint256 amount)"
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typehash,
                keccak256(abi.encode(keccak256("TokenPermissions(address token,uint256 amount)"), o.input.token, o.input.maxAmount)),
                REACTOR,
                o.info.nonce,
                o.info.deadline,
                _orderHash(o)
            )
        );
        (, bytes memory ds) = PERMIT2.staticcall(abi.encodeWithSignature("DOMAIN_SEPARATOR()"));
        return keccak256(abi.encodePacked("\x19\x01", abi.decode(ds, (bytes32)), structHash));
    }

    /// A maker order (RFQ shape): maker gives `warsOut` wARS for `usdtIn` USDT paid by the filler.
    function _makerFill(uint256 usdtIn, uint256 warsOut, uint256 nonce) internal returns (bytes memory) {
        address maker = vm.addr(makerKey);
        vm.prank(WARS_POOL);
        IERC20F(WARS).transfer(maker, warsOut);
        vm.prank(maker);
        IERC20F(WARS).approve(PERMIT2, type(uint256).max);

        LimitOrder memory o;
        o.info = OrderInfo(REACTOR, maker, nonce, block.timestamp + 60, address(0), "");
        o.input = InputToken(WARS, warsOut, warsOut);
        o.outputs = new OutputToken[](1);
        o.outputs[0] = OutputToken(USDT, usdtIn, maker);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerKey, _permit2Digest(o));
        return abi.encodeCall(IReactorF.execute, (IReactorF.SignedOrder(abi.encode(o), abi.encodePacked(r, s, v))));
    }

    function test_textile_guardFillsRealReactor_atFairPrice() public {
        (, uint256 fair) = guard.twapQuote(WARS_POOL, USDT, WARS, 10e6);
        bytes memory call_ = _makerFill(10e6, fair * 1001 / 1000, 1); // maker quotes 10 bps better than TWAP
        uint256 usdt0 = IERC20F(USDT).balanceOf(address(account));
        uint256 wars0 = IERC20F(WARS).balanceOf(address(account));
        vm.prank(address(account));
        (uint256 sold, uint256 bought) = guard.fillTextile(USDT, 10.1e6, WARS, 0, call_);
        console2.log("textile fill: sold USDT", sold, "bought wARS", bought);
        assertGe(sold, 10e6); // 10 USDT to the maker (+ any protocol fee)
        assertEq(bought, fair * 1001 / 1000);
        assertEq(usdt0 - IERC20F(USDT).balanceOf(address(account)), sold, "leftover refunded");
        assertEq(IERC20F(WARS).balanceOf(address(account)) - wars0, bought);
        assertEq(IERC20F(USDT).balanceOf(address(guard)), 0);
        assertEq(IERC20F(WARS).balanceOf(address(guard)), 0);
        assertEq(IERC20F(USDT).allowance(address(guard), REACTOR), 0);
    }

    function test_textile_badMakerPriceRejected() public {
        (, uint256 fair) = guard.twapQuote(WARS_POOL, USDT, WARS, 10e6);
        bytes memory call_ = _makerFill(10e6, fair * 90 / 100, 2); // 10% under the TWAP
        vm.prank(address(account));
        vm.expectRevert(); // MinOutBelowFloor (exact floor depends on the fee taken)
        guard.fillTextile(USDT, 10.1e6, WARS, 0, call_);
        assertEq(IERC20F(USDT).balanceOf(address(guard)), 0);
    }
}
