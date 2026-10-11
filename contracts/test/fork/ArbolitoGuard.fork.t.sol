// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {ArbolitoGuard as Guard} from "../../src/ArbolitoGuard.sol";

interface IERC20G {
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
}

interface IPoolG {
    function slot0()
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16 obsIndex, uint16 obsCard, uint16 obsCardNext, uint8, bool);
    function observe(uint32[] calldata) external view returns (int56[] memory, uint160[] memory);
}

interface IQuoterG {
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

interface IRouterG {
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

/// ArbolitoGuard (v2) against the real Uniswap v3 pools and SwapRouter02 on a Celo fork, with a
/// MiniPay-style EOA as the account and a separate operator EOA.
///   pnpm contracts:test:fork   (skips cleanly when not on chain 42220)
contract ArbolitoGuardForkTest is Test {
    address constant ROUTER = 0x5615CDAb10dc425a742d643d949a7F474C01abc4;
    address constant FACTORY = 0xAfE208a311B21f13EF87E33A90049fC17A7acDEc;
    address constant QUOTER = 0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8;
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

    Guard guard;
    // Fresh derived keys, never anvil's well-known dev accounts.
    address user = vm.addr(uint256(keccak256("arbolito guard v2 fork user")));
    address operator = vm.addr(uint256(keccak256("arbolito guard v2 fork operator")));
    address contact = makeAddr("contact");
    address stranger = makeAddr("stranger");
    address attacker = makeAddr("attacker");

    function setUp() public {
        if (block.chainid != 42220 || ROUTER.code.length == 0) vm.skip(true);
        address[] memory tokens = new address[](5);
        (tokens[0], tokens[1], tokens[2], tokens[3], tokens[4]) = (WARS, WBRL, USDT, USAT, USDC);
        address[] memory pools = new address[](3);
        (pools[0], pools[1], pools[2]) = (WARS_POOL, WBRL_POOL, USAT_POOL);
        guard = new Guard(ROUTER, FACTORY, WINDOW, tokens, pools);

        vm.startPrank(WARS_POOL);
        IERC20G(USDT).transfer(user, 100e6);
        IERC20G(WARS).transfer(user, 100_000e18);
        vm.stopPrank();
        vm.prank(WBRL_POOL);
        IERC20G(WBRL).transfer(user, 100e18);

        // Onboarding, all sent by the user's own EOA: bounded approvals, configure, operator.
        vm.startPrank(user);
        IERC20G(USDT).approve(address(guard), 50e6);
        IERC20G(WARS).approve(address(guard), 100_000e18);
        IERC20G(WBRL).approve(address(guard), 100e18);
        Guard.Config memory c = _config();
        c.limits = new Guard.TokenLimit[](3);
        c.limits[0] = Guard.TokenLimit(USDT, 20e6, 40e6);
        c.limits[1] = Guard.TokenLimit(WARS, 50_000e18, 100_000e18);
        c.limits[2] = Guard.TokenLimit(WBRL, 50e18, 100e18);
        c.recipients = new Guard.Recipient[](1);
        c.recipients[0] = Guard.Recipient(contact, true);
        guard.configure(c);
        guard.setOperator(operator, uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ helpers
    function _config() internal view returns (Guard.Config memory c) {
        c.account = user;
        c.maxSlippageBps = SLIPPAGE_BPS;
        c.limits = new Guard.TokenLimit[](0);
        c.recipients = new Guard.Recipient[](0);
        c.prices = new Guard.PriceRef[](0);
    }

    function _swap(bytes memory path, uint256 amountIn, uint256 minOut) internal returns (uint256) {
        vm.prank(operator);
        return guard.swapFor(user, path, amountIn, minOut);
    }

    function _quote(address tokenIn, address tokenOut, uint256 amountIn) internal returns (uint256 out) {
        (out,,,) = IQuoterG(QUOTER).quoteExactInputSingle(
            IQuoterG.QuoteExactInputSingleParams(tokenIn, tokenOut, amountIn, 100, 0)
        );
    }

    /// A small USDT -> wBRL swap that moves the tick, so the pool writes a fresh observation.
    function _pokeWbrlPool() internal {
        (, int24 tickBefore,,,,,) = IPoolG(WBRL_POOL).slot0();
        vm.prank(WARS_POOL);
        IERC20G(USDT).transfer(attacker, 20e6);
        vm.startPrank(attacker);
        IERC20G(USDT).approve(ROUTER, 20e6);
        IRouterG(ROUTER).exactInputSingle(IRouterG.ExactInputSingleParams(USDT, WBRL, 100, attacker, 20e6, 0, 0));
        vm.stopPrank();
        (, int24 tickAfter,,,,,) = IPoolG(WBRL_POOL).slot0();
        assertTrue(tickAfter != tickBefore, "poke moved the tick");
    }

    function _setWbrlRef(uint256 quoted) internal {
        Guard.Config memory c = _config();
        c.prices = new Guard.PriceRef[](1);
        c.prices[0] = Guard.PriceRef(WBRL, USDT, 10e18, uint128(quoted), uint64(block.timestamp + 600));
        vm.prank(user);
        guard.configure(c);
    }

    // ------------------------------------------------------------------ operator swaps on real pools
    function test_operatorSwap_realPool_USDTtoWARS_atFloor() public {
        bytes memory path = abi.encodePacked(USDT, uint24(100), WARS);
        uint256 floor = guard.minOutFloor(user, path, 10e6);
        uint256 quoted = _quote(USDT, WARS, 10e6);
        console2.log("10 USDT -> wARS: floor", floor, "quoter", quoted);
        assertGe(quoted, floor, "live pool clears the 50 bps floor");
        uint256 usdt0 = IERC20G(USDT).balanceOf(user);
        uint256 wars0 = IERC20G(WARS).balanceOf(user);
        uint256 g0 = gasleft();
        uint256 out = _swap(path, 10e6, floor);
        console2.log("swapFor gas (approx, warm fork)", g0 - gasleft());
        assertEq(out, quoted);
        assertEq(usdt0 - IERC20G(USDT).balanceOf(user), 10e6);
        assertEq(IERC20G(WARS).balanceOf(user) - wars0, out);
        assertEq(IERC20G(USDT).allowance(address(guard), ROUTER), 0, "approval reset");
        assertEq(IERC20G(USDT).balanceOf(address(guard)), 0);
        assertEq(IERC20G(WARS).balanceOf(address(guard)), 0);
        assertEq(IERC20G(WARS).balanceOf(operator), 0, "operator gets nothing");
        assertEq(guard.spentToday(user, USDT), 10e6);
    }

    function test_operatorSwap_multiHop_WARS_USDT_USAT() public {
        bytes memory path = abi.encodePacked(WARS, uint24(100), USDT, uint24(100), USAT);
        uint256 floor = guard.minOutFloor(user, path, 10_000e18);
        _swap(path, 10_000e18, floor);
        assertGe(IERC20G(USAT).balanceOf(user), floor);
    }

    function test_floor_rejectsBadMinOut() public {
        bytes memory path = abi.encodePacked(USDT, uint24(100), WARS);
        uint256 floor = guard.minOutFloor(user, path, 10e6);
        vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, 0, floor));
        _swap(path, 10e6, 0);
        vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, floor - 1, floor));
        _swap(path, 10e6, floor - 1);
        vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, floor * 95 / 100, floor));
        _swap(path, 10e6, floor * 95 / 100);
        assertEq(guard.spentToday(user, USDT), 0);
    }

    /// A same-block sandwich moves spot but not the TWAP: the floor holds and the swap reverts.
    function test_sandwichCannotLowerTheFloor() public {
        bytes memory path = abi.encodePacked(USDT, uint24(100), WARS);
        uint256 floorBefore = guard.minOutFloor(user, path, 10e6);
        vm.prank(WARS_POOL);
        IERC20G(USDT).transfer(attacker, 5_000e6);
        vm.startPrank(attacker);
        IERC20G(USDT).approve(ROUTER, 5_000e6);
        IRouterG(ROUTER).exactInputSingle(IRouterG.ExactInputSingleParams(USDT, WARS, 100, attacker, 5_000e6, 0, 0));
        vm.stopPrank();
        assertEq(guard.minOutFloor(user, path, 10e6), floorBefore, "TWAP unmoved in the same block");
        assertLt(_quote(USDT, WARS, 10e6), floorBefore, "spot now worse than the floor");
        vm.expectRevert(); // router: "Too little received"
        _swap(path, 10e6, floorBefore);
    }

    function test_operatorSend_contactOnly_andCannotConfigure() public {
        vm.prank(operator);
        guard.sendFor(user, USDT, contact, 5e6);
        assertEq(IERC20G(USDT).balanceOf(contact), 5e6);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotRecipient.selector, stranger));
        guard.sendFor(user, USDT, stranger, 1);

        Guard.Config memory c = _config();
        c.recipients = new Guard.Recipient[](1);
        c.recipients[0] = Guard.Recipient(stranger, true);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotAccount.selector, operator, user));
        guard.configure(c);

        vm.prank(user);
        guard.revokeOperator();
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotOperator.selector, operator, user));
        guard.sendFor(user, USDT, contact, 1e6);
    }

    // ------------------------------------------------------------------ wBRL: thin oracle history
    /// cardinalityNext is 64 on mainnet since 2026-10-11, but cardinality only grows as new
    /// observations are written. Depending on the fork block, observe(600) may or may not cover
    /// the window after a fresh swap. Both branches are checked.
    function test_wbrl_priceRef_naturalOracleState() public {
        (,, uint16 idx, uint16 card, uint16 cardNext,,) = IPoolG(WBRL_POOL).slot0();
        console2.log("wBRL pool observationIndex / cardinality / next", idx, card, cardNext);
        _pokeWbrlPool();
        (,,, card,,,) = IPoolG(WBRL_POOL).slot0();
        console2.log("  cardinality after poke", card);
        bytes memory path = abi.encodePacked(WBRL, uint24(100), USDT);
        uint256 quoted = _quote(WBRL, USDT, 10e18);
        (bool ok, uint256 twapOut) = guard.twapQuote(WBRL_POOL, WBRL, USDT, 10e18);
        console2.log("  twap ok", ok, "twapOut", twapOut);

        if (!ok) {
            // Not enough history to cover 600 s: no TWAP and no ref means no swap at all.
            vm.expectRevert(abi.encodeWithSelector(Guard.NoPriceReference.selector, WBRL, USDT));
            _swap(path, 10e18, 1);
            _setWbrlRef(quoted);
            uint256 floor = guard.minOutFloor(user, path, 10e18);
            assertEq(floor, quoted * (10_000 - SLIPPAGE_BPS) / 10_000, "floor from the account's ref");
            vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, 0, floor));
            _swap(path, 10e18, 0);
            _swap(path, 10e18, floor);
        } else {
            // History covers the window: the floor is the stricter of TWAP and ref.
            _setWbrlRef(quoted);
            uint256 floor = guard.minOutFloor(user, path, 10e18);
            uint256 hi = twapOut > quoted ? twapOut : quoted;
            assertEq(floor, hi * (10_000 - SLIPPAGE_BPS) / 10_000, "stricter of TWAP and ref");
            vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, 0, floor));
            _swap(path, 10e18, 0);
            if (quoted >= floor) _swap(path, 10e18, floor);
        }
    }

    /// The TWAP made unavailable deterministically (observe reverts "OLD", which is what a thin
    /// oracle does). The account's price ref is used, and the real pool executes the swap.
    function test_wbrl_usesPriceRef_whenTwapUnavailable() public {
        vm.mockCallRevert(WBRL_POOL, abi.encodeWithSelector(IPoolG.observe.selector), bytes("OLD"));
        (bool ok,) = guard.twapQuote(WBRL_POOL, WBRL, USDT, 10e18);
        assertFalse(ok);
        bytes memory path = abi.encodePacked(WBRL, uint24(100), USDT);
        vm.expectRevert(abi.encodeWithSelector(Guard.NoPriceReference.selector, WBRL, USDT));
        _swap(path, 10e18, 1);

        uint256 quoted = _quote(WBRL, USDT, 10e18);
        _setWbrlRef(quoted);
        uint256 floor = guard.minOutFloor(user, path, 10e18);
        assertEq(floor, quoted * (10_000 - SLIPPAGE_BPS) / 10_000);
        vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, 0, floor));
        _swap(path, 10e18, 0);
        uint256 usdt0 = IERC20G(USDT).balanceOf(user);
        uint256 out = _swap(path, 10e18, floor);
        assertEq(out, quoted);
        assertEq(IERC20G(USDT).balanceOf(user) - usdt0, out);
        assertEq(IERC20G(WBRL).allowance(address(guard), ROUTER), 0);

        // The ref expires after 600 s, and then the guard refuses again (TWAP still mocked down).
        vm.warp(block.timestamp + 601);
        vm.expectRevert(abi.encodeWithSelector(Guard.NoPriceReference.selector, WBRL, USDT));
        _swap(path, 10e18, floor);
    }
}
